export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'지원하지 않는 요청입니다.'});
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({error:'허용되지 않는 요청입니다.'});
  if (!process.env.SUPABASE_URL) return res.status(503).json({error:'계정 서버 연결을 준비 중입니다. 기기 저장은 사용할 수 있습니다.'});
  try {
    const response = await fetch(`${process.env.SUPABASE_URL.trim()}/functions/v1/jamsildo-account`, {
      method:req.method,
      headers:{'Content-Type':req.headers['content-type'] || 'application/json',cookie:req.headers.cookie || '', 'x-jamsildo-client-ip':req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'},
      body:req.method === 'POST' ? JSON.stringify(req.body) : undefined,
      signal:AbortSignal.timeout(25000),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('Set-Cookie',cookies);
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.status(response.status).send(await response.text());
  } catch { res.status(503).json({error:'계정 서버에 연결하지 못했습니다. 기기 기록은 유지됩니다.'}); }
}
