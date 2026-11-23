# Разработка — Veggie Battle Royale

## Архитектура

Игра разделена на два слоя — это сделано специально, чтобы всю механику
можно было перенести на Roblox/Luau без переписывания:

| Слой | Папка | Что можно импортировать |
|------|-------|------------------------|
| Логика | `src/logic/` | Только `vec3`, `rng`, `config`, другие модули логики. **Запрещено**: `three`, DOM, `window` |
| Вью | `src/view/` | Three.js, DOM, всё что угодно |

Симуляция гоняется фиксированным шагом `step(state, input, dt)`.
Векторы — обычные объекты `{x, y, z}`, хелперы в `src/logic/vec3.js`.
Коллизии — swept segment-тесты в `src/logic/raycast.js` (не `THREE.Raycaster`).

Вся балансировка — в `src/logic/config.js` (`CONFIG`). Чисел по коду быть не должно.

### Файлы

- `src/logic/config.js` — все настройки: оружие, баки/тостеры, боты, зона, балкон, карта.
- `src/logic/world.js` — `createState()`, `step()`, генерация карты, пикапы, зона, балкон.
- `src/logic/weapon.js` — стрельба обоих стволов, снаряды, слизь с пушек.
- `src/logic/bin.js` — очки прилипаний, превращение в бак/тостер, пинок, ревайв.
- `src/logic/bots.js` — ИИ ботов (стрейфы, дистанция боя, тосты, пушки, застревания).
- `src/logic/raycast.js` — swept коллизии с AABB.
- `src/logic/rng.js` — детерминированный RNG (сид 1337).
- `src/view/main.js` — цикл, инпут-глюк, тест-хуки.
- `src/view/sceneView.js` — рендер: воксели, снаряды, вьюмодели GLB, бак/тостер, балкон, пушки.
- `src/view/input.js` — клавиатура/мышь/колесо.
- `src/view/hud.js` — HUD, киллфид, чипы оружия.

## Тест-хуки (для Playwright/консоли)

В странице доступны:

```js
render_game_to_text()   // JSON состояния мира
advanceTime(ms)         // прогнать симуляцию на ms миллисекунд
__state()               // сырое состояние (state.entities, state.voxels и т.д.)
__input                 // инжект ввода: __input.slotSel = 1, __input.fire = true
__view                  // ссылка на view (камера и пр.)
```

Пример проверки: `advanceTime(3000)` → `__state().projectiles` покажет летящие снаряды.

## Оружие

| | Овощемёт (слот 1) | Хламомёт (слот 2) |
|--|-------------------|-------------------|
| Модель | `assets/models/ovoschemet.glb` | `assets/models/Hlamomet.glb` |
| Снаряды | 6 видов овощей, случайно | тостер + кофеварка + вилка + ложка |
| Залп | 1 снаряд | 4 снаряда с разбросом (дробовик) |
| Очки за прилипание | 1 | 2 |
| Кулдаун | 0.18 с | 0.55 с |

GLB грузятся через `vendor/loaders/GLTFLoader.js`; если файла нет —
процедурный фолбэк. Внешняя текстура — `assets/models/Textures/colormap.png`
(копия из кита Kenney, сам кит в .gitignore).

## Проверки после правок

1. `node --check src/logic/*.js src/view/*.js`
2. Headless: `node --input-type=module -e "import {createState, step} from './src/logic/world.js'; ..."`
3. Браузер: `http://127.0.0.1:8000` → `advanceTime()` + `render_game_to_text()` + консоль на ошибки.

## Деплой

Игра — чистая статика (нет сборки). Three.js завендорен в `vendor/` —
`node_modules` для запуска не нужен. Заливается как есть:

- **GitHub Pages**: репозиторий → Settings → Pages → Deploy from branch `main` (root).
- Любой статик-хостинг (Netlify/Vercel/свой сервер): раздача корня проекта.

## Порт на Roblox

Слой `src/logic/` спроектирован под перенос на Luau: векторы-плоские таблицы,
никакого three.js, фиксированный шаг, события в `state.events` — вью их
отыгрывает. См. `.devin/skills/roblox-luau-port/SKILL.md`.
