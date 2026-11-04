# JAMSILDO — Combo / Ultimate VFX & Human Sena Pixel Assets (v1)

잠실도 게임에서 사용할 수 있는 **투명 PNG 에셋 7종** 묶음입니다.

## 포함 구성

| ID | 파일 | 설명 |
| --- | --- | --- |
| combo_fire_water_mer_kui_steam_vortex | `assets/combos/combo_fire_water_mer_kui_steam_vortex.png` | 메르(불)와 쿠이(물)가 함께 만드는 증기 나선 합동기 |
| combo_light_dark_luna_kai_eclipse_slash | `assets/combos/combo_light_dark_luna_kai_eclipse_slash.png` | 루나(빛)와 카이(어둠)의 일식 베기 합동기 |
| ultimate_fire_mer_gigantic_flame_cannon | `assets/ultimates/ultimate_fire_mer_gigantic_flame_cannon.png` | 초대형 불대포 |
| ultimate_water_kui_horizontal_tsunami | `assets/ultimates/ultimate_water_kui_horizontal_tsunami.png` | 화면을 가로지르는 거대 파도 |
| ultimate_light_luna_divine_sword_slash | `assets/ultimates/ultimate_light_luna_divine_sword_slash.png` | 신성한 빛의 검 베기 |
| ultimate_dark_kai_reaper_scythe_slash | `assets/ultimates/ultimate_dark_kai_reaper_scythe_slash.png` | 소환된 리퍼의 낫 베기 |
| character_sena_human_idle_3q | `assets/characters/character_sena_human_idle_3q_128x192.png` | 인간형 세나, 3/4 전신 기본 포즈 |

인간형 세나의 256×384 PNG도 함께 포함했습니다.
`masters/`에는 생성 원본 해상도의 PNG가 있습니다.
`asset_manifest.json`에는 AI/코드가 파싱하기 쉬운 ID, 상대 경로, 용도, 크기, 방향성이 들어 있습니다.

## 설치

웹 프로젝트(React / Next.js / Canvas 등)에서:

1. 이 폴더 전체를 `public/game_assets/jamsildo_vfx_combo_ultimate_sena_v1/` 안에 놓습니다.
2. 스프라이트 PNG를 이미지로 로드합니다. 타입스크립트 경로 목록을 사용하려면 `integration/jamsildo_assets.ts` 파일만 별도로 게임의 `src/` 폴더로 복사합니다. (`public/` 안의 TS 파일을 직접 import하지 않습니다.)
3. 게임 월드 좌표에 맞는 크기로 렌더링합니다. 모든 PNG는 배경이 투명합니다.

```ts
// integration/jamsildo_assets.ts를 src/에 복사한 경우:
import { JAMSILDO_ASSETS } from "./jamsildo_assets";

const url = JAMSILDO_ASSETS.ultimate_fire_mer_gigantic_flame_cannon.src;
const image = new Image();
image.src = url;
// image.onload 후 게임 캔버스에 drawImage()
```

```js
ctx.imageSmoothingEnabled = false;
ctx.drawImage(image, x, y, drawWidth, drawHeight);
```

CSS로 확대하는 캔버스에는 `image-rendering: pixelated`도 적용할 수 있습니다.

## 범위와 주의 사항

- 7종은 모두 **정지 PNG 1프레임**이며, 이 패키지는 애니메이션 스프라이트 시트가 아닙니다.
- 불·물, 빛·어둠 합동기에는 시전 정령 2마리의 모습이 포함되어 있습니다.
- 크기가 큰 스킬은 보스급 시각 연출용으로 제작되었습니다. 게임의 카메라·충돌 범위·밸런스에 맞춰 화면 크기를 조정하세요.
- `assets/` PNG는 원본을 픽셀 경계가 유지되도록 축소한 간편 사용본입니다. 원본은 `masters/`에 그대로 보존했습니다.
- 생성 기반 도트 아트이므로 완전히 규칙적인 1픽셀 수작업 스프라이트를 보장하지 않습니다. 최종 출시용 프레임 애니메이션은 Aseprite 등에서 추가 정리가 필요합니다.

