// Supabase Auth owns password hashing and session validation; keys stay in Edge Function secrets.
export function createHandler({ url, key, serviceKey }) {
  return async function handle(request) {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
    const cookie = (name, value, age) => headers.append('Set-Cookie', `jamsildo_${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${age}`);
    const setSession = session => { cookie('access', session.access_token, session.expires_in || 3600); cookie('refresh', session.refresh_token, 2592000); };
    const api = async (path, { token, service = false, method = 'GET', body, extra = {} } = {}) => {
      const response = await fetch(`${url}${path}`, {
        method, headers: { apikey: service ? serviceKey : key, ...(token || (service && serviceKey.startsWith('eyJ')) ? { Authorization: `Bearer ${token || serviceKey}` } : {}), 'Content-Type': 'application/json', ...extra },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = Object.assign(new Error(data?.message || data?.msg || data?.error_description || 'database_error'), { status: response.status, code: data?.code });
        throw error;
      }
      return { data, response };
    };
    try {
      if (!['GET','POST'].includes(request.method)) return json({ error: '지원하지 않는 요청입니다.' }, 405);
      let body = {};
      if (request.method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON 요청만 허용됩니다.' }, 415);
        const text = await request.text();
        if (text.length > 50000) return json({ error: '저장 데이터가 너무 큽니다.' }, 413);
        try { body = JSON.parse(text); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '잘못된 요청입니다.' }, 400);
      }
      const action = request.method === 'GET' ? 'status' : body.action;
      const ip = request.headers.get('x-jamsildo-client-ip') || request.headers.get('x-forwarded-for') || 'unknown';
      const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,'0')).join('');
      if (action === 'guest') {
        // 로그인 없이 받는 유일한 쓰기: 형식을 엄격히 보고, IP는 해시로 횟수만 센다 (저장은 rate_limits의 해시뿐)
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        if (typeof body.guest !== 'string' || !uuid.test(body.guest) || typeof body.session !== 'string' || !uuid.test(body.session) ||
          !Number.isInteger(body.seconds) || body.seconds < 0 || body.seconds > 2147483647 || !Number.isInteger(body.stage) || body.stage < 1 || body.stage > 20) fail('잘못된 요청입니다.');
        const { data: allowed } = await api('/rest/v1/rpc/jamsildo_rate_limit', { service: true, method: 'POST', body: { p_key: await digest(`guest:ip:${ip}`), p_limit: 240 } });
        if (!allowed) fail('시도가 너무 많습니다. 10분 후 다시 시도해 주세요.',429);
        await api('/rest/v1/rpc/jamsildo_guest_ping', { service: true, method: 'POST', body: { p_guest: body.guest, p_session: body.session, p_seconds: body.seconds, p_stage: body.stage } });
        return json({ ok:true });
      }
      if (action === 'login' || action === 'register') {
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        if (!/^[a-z0-9_]{3,20}$/.test(username)) fail('아이디는 영문 소문자·숫자·밑줄 3~20자로 입력해 주세요.');
        if (typeof body.password !== 'string' || body.password.length < (action === 'register' ? 8 : 1) || body.password.length > 72) fail('비밀번호는 8~72자로 입력해 주세요.');
        for (const [bucket, limit] of [[`${action}:ip:${ip}`, action === 'register' ? 10 : 50], [`${action}:user:${username}`, 10]]) {
          const { data } = await api('/rest/v1/rpc/jamsildo_rate_limit', { service: true, method: 'POST', body: { p_key: await digest(bucket), p_limit: limit } });
          if (!data) fail('시도가 너무 많습니다. 10분 후 다시 시도해 주세요.',429);
        }
        const email = `${username}@players.jamsildo.invalid`;
        if (action === 'register') {
          if (username === 'jp0405') fail('사용할 수 없는 아이디입니다.',409);
          try { await api('/auth/v1/admin/users', { service: true, method: 'POST', body: { email, password: body.password, email_confirm: true } }); }
          catch (error) { if (error.status < 500) fail('사용 중이거나 사용할 수 없는 아이디입니다.',409); throw error; }
        }
        let session;
        try { session = (await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: body.password } })).data; }
        catch (error) { if (error.status < 500) fail('아이디 또는 비밀번호를 확인해 주세요.',401); throw error; }
        const { data: players } = await api(`/rest/v1/jamsildo_players?id=eq.${session.user.id}&select=*`, { token: session.access_token });
        if (!players[0] || players[0].blocked) fail('이용이 제한된 계정입니다.',403);
        setSession(session);
        const { data: saves } = await api(`/rest/v1/jamsildo_saves?user_id=eq.${session.user.id}&select=*`, { token: session.access_token });
        return json({ user: players[0], save: saves[0] });
      }
      const cookies = Object.fromEntries((request.headers.get('cookie') || '').split(';').map(part => { const i=part.indexOf('='); return [part.slice(0,i).trim(),part.slice(i+1)]; }));
      let token = decodeURIComponent(cookies.jamsildo_access || '');
      let user;
      if (token) {
        try { user = (await api('/auth/v1/user', { token })).data; }
        catch (error) { if (error.status !== 401 && error.status !== 403) throw error; }
      }
      if (!user && cookies.jamsildo_refresh) {
        try {
          const { data: session } = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: decodeURIComponent(cookies.jamsildo_refresh) } });
          token = session.access_token; user = session.user; setSession(session);
        } catch (error) { if (error.status >= 500) throw error; }
      }
      if (action === 'logout') {
        if (user) await api('/auth/v1/logout?scope=local', { token, method: 'POST' });
        cookie('access','',0); cookie('refresh','',0); return json({ ok:true });
      }
      if (!user) {
        if (action === 'status') return json({ user:null });
        fail('로그인이 만료되었습니다. 다시 로그인해 주세요.',401);
      }
      const { data: profiles } = await api(`/rest/v1/jamsildo_players?id=eq.${user.id}&select=*`, { token });
      const profile = profiles[0];
      if (!profile || profile.blocked) fail('이용이 제한된 계정입니다.',403);
      if (action === 'status') {
        const { data: saves } = await api(`/rest/v1/jamsildo_saves?user_id=eq.${user.id}&select=*`, { token });
        return json({ user:profile, save:saves[0] });
      }
      if (action === 'sync') {
        if (!Number.isInteger(body.revision) || body.revision < 0 || !Number.isInteger(body.seconds) || body.seconds < 0 || body.seconds > 2147483647 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.session)) fail('잘못된 저장 요청입니다.');
        const { data } = await api('/rest/v1/rpc/jamsildo_sync', { token, method:'POST', body:{p_revision:body.revision,p_checkpoint:body.checkpoint ?? null,p_session:body.session,p_seconds:body.seconds} });
        return json(data);
      }
      if (action === 'password') {
        if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 72 || typeof body.current !== 'string' || body.current.length > 72) fail('새 비밀번호는 8~72자로 입력해 주세요.');
        try { await api('/auth/v1/token?grant_type=password', { method:'POST', body:{email:user.email,password:body.current} }); }
        catch { fail('현재 비밀번호가 일치하지 않습니다.',400); }
        await api('/auth/v1/user', { token, method:'PUT', body:{password:body.password} });
        return json({ok:true});
      }
      if (action === 'admin' || action === 'block') {
        if (user.app_metadata?.jamsildo_admin !== true || !profile.is_admin) fail('관리자만 접근할 수 있습니다.',403);
        if (action === 'block') {
          if (typeof body.blocked !== 'boolean' || typeof body.target !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.target)) fail('잘못된 계정 요청입니다.');
          await api('/rest/v1/rpc/jamsildo_admin_block', { token, method:'POST', body:{p_target:body.target,p_blocked:body.blocked} });
          return json({ok:true});
        }
        const search = typeof body.search === 'string' ? body.search.trim().toLowerCase() : '';
        if (search && !/^[a-z0-9_]{1,20}$/.test(search)) fail('아이디로 검색해 주세요.');
        const page = Number.isInteger(body.page) && body.page >= 0 && body.page < 100000 ? body.page : 0;
        const order = ['created_at','last_seen','play_seconds','max_stage'].includes(body.order) ? body.order : 'created_at';
        const { data: stats } = await api('/rest/v1/rpc/jamsildo_admin_overview', { token, method:'POST', body:{} });
        const { data: players, response } = await api(`/rest/v1/jamsildo_players?select=*&is_admin=eq.false${search ? `&username=like.*${search.replaceAll('_','\\_')}*` : ''}&order=${order}.desc,id.asc&offset=${page*25}&limit=25`, { service:true, extra:{Prefer:'count=exact'} });
        const { data: audit } = await api('/rest/v1/jamsildo_admin_log?select=action,created_at,target,player:jamsildo_players!jamsildo_admin_log_target_fkey(username)&order=created_at.desc&limit=10', { service:true });
        // 게스트 표가 아직 없는 서버에서도 콘솔은 열려야 한다
        const guestPage = Number.isInteger(body.guestPage) && body.guestPage >= 0 && body.guestPage < 100000 ? body.guestPage : 0;
        const guests = await api('/rest/v1/rpc/jamsildo_admin_guests', { token, method:'POST', body:{p_page:guestPage} }).then(result => result.data).catch(() => null);
        return json({stats,players,total:Number(response.headers.get('content-range')?.split('/')[1] || 0),audit,guests});
      }
      return json({error:'지원하지 않는 요청입니다.'},400);
    } catch (error) {
      if (error.message.includes('save_conflict')) return json({error:'다른 기기에서 새 기록이 저장되었습니다. 새로고침해 최신 기록을 불러와 주세요.'},409);
      if (error.message.includes('invalid_checkpoint')) return json({error:'저장 데이터를 확인할 수 없습니다.'},400);
      if (error.message.includes('account_blocked')) return json({error:'이용이 제한된 계정입니다.'},403);
      if (error.status && error.status < 500 && /[가-힣]/.test(error.message)) return json({error:error.message},error.status);
      console.error('jamsildo-account request failed', { status:error.status, code:error.code, name:error.name });
      return json({error:'서버 연결에 실패했습니다. 기기 기록은 유지됩니다. 잠시 후 다시 시도해 주세요.'},503);
    }
  };
}
