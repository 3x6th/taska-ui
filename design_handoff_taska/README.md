# Handoff: Taska — issue tracker (Jira-аналог)

## Overview
Taska — лёгкий issue-трекер в стиле Linear: список проектов, kanban-доска с drag-and-drop,
slide-over карточка задачи, логин/accept-invite, уведомления. Дизайн покрывает 4 экрана
из «минимального набора» вашего REST-контракта (Login, Project list, Board, Issue card)
плюс create-issue и notifications. Тема — светлая/тёмная с переключателем.

## About the Design Files
В этом бандле лежит **дизайн-референс, сделанный в HTML** (`Taska.dc.html`) — это прототип,
показывающий внешний вид и поведение, а **не продакшн-код для копирования**.

`Taska.dc.html` написан как «Design Component» (свой рантайм со streaming-шаблоном) — это
формат среды, где он создавался, а **не** то, что нужно тащить в проект. Задача —
**воссоздать эти экраны в вашем фронтенд-окружении** его средствами:

- Если фронта ещё нет — рекомендую **React + TypeScript + Vite**, роутинг `react-router`,
  server-state через `@tanstack/react-query`, dnd через `@dnd-kit/core`. Стили — CSS Modules
  или Tailwind (на ваш вкус). Все значения ниже даны так, чтобы лечь в любой из вариантов.
- Если фронт есть — берите существующие паттерны (компоненты, токены, дата-слой) и
  воспроизводите вёрстку/поведение по этому README.

Чтобы посмотреть прототип вживую: откройте `Taska.dc.html` в браузере (он самодостаточный).

## Fidelity
**High-fidelity.** Цвета, типографика, отступы, радиусы и анимации — финальные. Воспроизводить
пиксель-в-пиксель, опираясь на токены в разделе Design Tokens. Иконки — простые inline-SVG
(см. ниже), их можно заменить на вашу icon-библиотеку (lucide/heroicons) с теми же глифами.

---

## Архитектура / маршруты
Рекомендуемое соответствие экранов и URL (совпадает со схемой `link` в notifications контракта):

| Экран | Route | Контрактные ручки |
| --- | --- | --- |
| Login / Accept invite | `/login`, `/invite?token=…` | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/invitations/accept`, `GET /users/me` |
| Projects | `/projects` | `GET /projects`, `POST /projects` |
| Board | `/projects/:projectId/board` | `GET /projects/:id`, `GET /projects/:id/membership`, `GET /projects/:id/workflow`, `GET /projects/:id/issues` (или `GET /projects/:id/board`), `POST /issues/:id/transitions` |
| Issue card (slide-over поверх Board) | `/projects/:projectId/issues/:issueId` | `GET /…/issues/:id`, `PATCH /…/issues/:id`, `PUT /…/issues/:id/assignee`, `POST /…/issues/:id/transitions`, `DELETE /…/issues/:id` |
| Notifications (popover) | — | `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` |

Issue card — это **slide-over панель поверх доски**, а не отдельная страница; URL меняется, доска
остаётся под затемнением. Закрытие панели/бэкдропа возвращает на `/board`.

---

## Screens / Views

### 1. Login / Accept invite
- **Purpose:** вход или активация приглашённого пользователя.
- **Layout:** полноэкранный flex-центр. За карточкой — мягкое radial-свечение акцентом
  (`radial-gradient(620px 440px at 50% 32%, color-mix(in oklab, accent 16%, transparent), transparent 70%)`).
  Над карточкой — лого (квадрат-маркер 26px + «Taska» 19px/700). Theme-toggle — в правом верхнем углу (34px).
- **Card:** width 392, `background:surface`, `border:1px border`, `radius:16px`, `padding:26px`, shadow.
  - Сегмент-переключатель сверху: `[Sign in | Accept invite]` — pill-табы в контейнере `surface-2`,
    активный таб `surface` + тень; высота таба 30px, radius 7px.
  - **Sign in:** поля Email, Password (label 11.5px/550 `fg-2` + input height 38, radius 9, border-strong).
    Кнопка «Sign in» (accent, height 39, radius 9, 13.5px/600). Подпись-подсказка 11.5px `fg-3`.
  - **Accept invite:** инфо-блок (`surface-2`, radius 9), поле Invite token (моноширинный),
    поле New password, кнопка «Activate account».
- **Behavior:** submit → переход на `/projects`. (В проде: вызвать login/accept, сохранить токены,
  затем `GET /users/me`, потом редирект.) Анимация входа карточки `tk-pop` 0.5s.

### 2. Projects
- **Purpose:** выбрать проект.
- **Layout:** topbar 52px (`surface`, нижний бордер): лого слева; справа theme-toggle + аватар юзера 28px.
  Контент: max-width 980, центр. Заголовок «Projects» 22px/700 + подзаголовок «N projects · you're a member».
  Кнопка «New project» (accent, 34px). Грид карточек `repeat(auto-fill, minmax(300px,1fr))`, gap 14.
- **Project card:** `background:surface`, `border 1px`, `radius:13px`, `padding:17px`, shadow; курсор pointer.
  hover: `border-strong` + `translateY(-2px)`.
  - Строка: key-бейдж (моно 11px, `background:color-mix(in oklab, projColor 16%, transparent)`,
    `color:projColor`, radius 7) + название 14px/600 (эллипсис).
  - Описание 12px `fg-2`.
  - Низ: стопка аватаров участников (24px, `border:2px surface`, наложение `margin-right:-7px`) +
    «N members» 11.5px `fg-3`; справа «<b>count</b> issues».
- **Behavior:** клик по карточке → `/projects/:id/board`.
- **Project accent colors (для key-бейджа):** TAS `#6366f1`, WEB `#0ea5e9`, MOB `#8b5cf6`, OPS `#0d9488`.

### 3. Board (kanban)
- **Purpose:** видеть и двигать задачи по статусам.
- **Top bar (52px):** кнопка назад (chevron) → project key-бейдж → название проекта 14px/650 →
  бледное «Board». Справа: поиск (220px, `border-strong`, radius 9, иконка-лупа + input), колокол
  уведомлений (с точкой непрочитанного), theme-toggle, кнопка «New» (accent).
- **Filter bar (46px):** сегмент типов `[All | Task | Bug | Story]` (контейнер `surface-2`, активный
  `surface`+тень, кнопки height 24/radius 6). Разделитель. Лейбл «Assignee» + кнопка «All» + аватары
  участников (26px) — активный фильтр обведён `outline:2px accent; outline-offset:1.5px`. Справа —
  «Clear» (если есть фильтр) и счётчик «X of Y».
- **Columns area:** горизонтальный flex, gap 14, `padding:16px 18px`, фон `bg`, скролл по X.
  - **Column:** width 312, `radius:13`, `padding:11px 9px 4px`; фон `surface-2` при `columnFill=subtle`
    (по умолчанию) либо прозрачный при `plain`. При drag-over подсветка `inset 0 0 0 2px accent`.
    Заголовок: status-dot 8px (TODO `#9aa0aa`, IN_PROGRESS `accent`, DONE `#3fa863`) + имя 12.5px/650
    (`color:fg` — задавать color явно!) + count-pill (11px, `surface-2`, radius 20) + «+».
  - **Issue card (draggable):** `background:surface`, `border 1px`, `radius:11`,
    `padding:12px 13px` (10px 12px в `minimal`), shadow, `cursor:grab`; hover: `border-strong` + тень.
    При перетаскивании `opacity:.4`.
    - Шапка: type-chip (14px квадрат `radius 4`, для BUG — круг `50%`) + issueKey (моно 11px `fg-3`) +
      тип uppercase 10.5px `fg-3` + (справа) priority-bars.
    - Заголовок задачи 13px/500 `fg`.
    - (в `detailed`) превью описания 11.5px `fg-2`, `-webkit-line-clamp:2`.
    - Низ: дата создания (`MMM d`, 11px `fg-3`) + аватар исполнителя 24px (если нет — пунктирный круг).
  - Пустая колонка: «Drop issues here» в пунктирной рамке.
- **Type chip colors:** TASK `#4f7cf0`, STORY `#3fa863`, BUG `#e5544b`.
- **Priority bars:** три бара высотой 5/8/11px, ширина 3px, radius 1; залито `level` штук цветом,
  остальное `border-strong`. LOW=1 `#9aa0aa`, MEDIUM=2 `#e3a008`, HIGH=3 `#e5544b`.

### 4. Issue card (slide-over)
- **Purpose:** просмотр/редактирование задачи.
- **Layout:** бэкдроп `rgba(12,12,22,.32)` (fade-in) + панель справа width 480 (max 92vw), `surface`,
  левый бордер, тень `-12px 0 40px`, slide-in `tk-slide` 0.22s.
  - **Header (52px):** type-chip + issueKey (моно 12px) + тип uppercase; справа — Delete (hover → `#e5544b`)
    и Close (X).
  - **Body (скролл, padding 20–22):**
    - Заголовок — `textarea` 19px/650 (инлайн-редактирование summary; focus подсвечивает рамку).
    - Статус-строка: status-pill (`color/bg = color-mix статусного цвета`) → стрелка → кнопки переходов
      (height 29, border-strong, hover → accent). Переходы: TODO→[Start progress];
      IN_PROGRESS→[Mark done, Move to To Do]; DONE→[Reopen].
    - Мета-грид (88px / 1fr), разделители сверху/снизу:
      - **Assignee:** ряд выбираемых «чипов» (None + участники) — выбранный обведён accent + tint-фон.
      - **Priority:** сегмент `[Low | Medium | High]` (контейнер `surface-2`).
      - **Reporter:** аватар 22px + имя.
      - **Created:** `MMM d, HH:mm`.
    - **Description:** `textarea` (min-height 84, `surface-2`, radius 10; focus → `surface`+accent).
    - **Activity:** вертикальная лента с соединительной линией слева; на каждом событии аватар 24px,
      «<b>Имя</b> текст» + время. Тексты: created this issue / moved A → B / assigned X /
      set priority to P. Новые — сверху.
- **Behavior:** правки summary/description — оптимистично в стейт (в проде debounce → `PATCH`);
  смена assignee → `PUT …/assignee`; priority → `PATCH`; переход статуса → `POST …/transitions`;
  Delete → `DELETE`, затем закрыть панель и убрать карточку с доски.

### 5. Create issue (modal)
- Модалка по центру-сверху (padding-top 11vh), width 480, `radius:15`, тень. Header с key-бейджем
  проекта + «New issue» + close. Поля: Summary (15px/550), Description (textarea), сегменты Type и
  Priority. Футер `surface-2`: «Cancel» (outline) + «Create issue» (accent).
- **Behavior:** Create при непустом summary → создаёт задачу в статусе TODO (`POST /issues`),
  присваивает следующий `issueNumber`/`issueKey`, открывает её в slide-over.

### 6. Notifications (popover)
- Поповер 312px под колоколом: header «Notifications» + «Mark all read»; список (dot непрочитанного =
  accent, прочитанный = пустой кружок) с title/body/time. В проде: `GET /notifications`,
  `PATCH /:id/read`, `PATCH /read-all`; точка на колоколе = есть непрочитанные.

---

## Interactions & Behavior
- **Навигация:** Login → Projects → Board → (Issue slide-over). Кнопка назад на доске → Projects.
- **Drag-and-drop:** карточки `draggable`. onDragStart запоминает issueId; колонка onDragOver
  (`preventDefault`) подсвечивается; onDrop вызывает переход в статус колонки и пишет history-событие
  `TRANSITIONED`. В проде — `@dnd-kit`, оптимистичное обновление + `POST …/transitions`, откат при ошибке.
- **Фильтры:** тип + assignee + текстовый поиск (по summary и issueKey), комбинируются (AND); «Clear»
  сбрасывает. В проде часть фильтров можно отдать серверу (`status`, `assigneeId` в `GET issues`).
- **Тема:** переключатель меняет набор CSS-переменных на корне (см. токены).
- **Анимации:** entrance `tk-pop`/`tk-slide`/`tk-fade`; hover-переходы 0.12s ease на бордерах/тенях/opacity.
  Важно: не делайте контент зависимым от entrance-анимаций (fill-mode не должен прятать контент).
- **States:** добавьте loading (скелетоны колонок/списка), empty (пустые колонки уже есть), error
  (тосты по error-схеме контракта `{code,message,requestId}`).

## State Management
- **session:** currentUser (`GET /users/me`), accessToken/refresh (контракт `auth/*`).
- **routing:** currentProjectId, selectedIssueId (из URL).
- **board:** filters `{ q, type: ALL|TASK|BUG|STORY, assignee: ALL|userId }`, dragIssueId, dragOverStatus.
- **server-state (react-query):** projects, membership, workflow, issues (по проекту), issue+history,
  notifications. Мутации: createIssue, updateIssue, assignIssue, transitionIssue, deleteIssue,
  markRead/markAllRead — все оптимистичные с инвалидацией.
- **ui:** theme (`light|dark`, persist в localStorage), notifOpen, creating, draft.
- **Enums** — ровно как в контракте: IssueType `TASK|BUG|STORY`, IssuePriority `LOW|MEDIUM|HIGH`,
  IssueStatus `TODO|IN_PROGRESS|DONE`, ProjectRole `ADMIN|MEMBER|VIEWER`. Видимость действий
  (создание/редактирование/переходы) гейтить по роли из `GET …/membership` (VIEWER — только чтение).

## Design Tokens

### Colors — Light (значения на корне)
```
--bg:#f6f6f8;  --surface:#ffffff;  --surface-2:#f0f0f3;  --surface-3:#e9e9ee;
--border:rgba(22,22,32,.09);  --border-strong:rgba(22,22,32,.15);
--fg:#17171b;  --fg-2:#56565f;  --fg-3:#9090a0;
--accent:#4f46e5;  --accent-fg:#ffffff;
--shadow:0 1px 2px rgba(20,20,40,.05),0 4px 14px rgba(20,20,40,.05);
--radius:10px;
```
### Colors — Dark (override на корне при theme=dark)
```
--bg:#08080b;  --surface:#141418;  --surface-2:#0f0f13;  --surface-3:#1c1c22;
--border:rgba(255,255,255,.08);  --border-strong:rgba(255,255,255,.15);
--fg:#ededf1;  --fg-2:#9c9ca6;  --fg-3:#62626d;
--accent: color-mix(in oklab, #4f46e5, white 22%);  --accent-fg:#ffffff;
--shadow:0 1px 2px rgba(0,0,0,.5),0 6px 18px rgba(0,0,0,.4);
```
### Semantic colors
```
TASK #4f7cf0 · STORY #3fa863 · BUG #e5544b
priority: LOW #9aa0aa · MEDIUM #e3a008 · HIGH #e5544b
status dot: TODO #9aa0aa · IN_PROGRESS var(--accent) · DONE #3fa863
project keys: TAS #6366f1 · WEB #0ea5e9 · MOB #8b5cf6 · OPS #0d9488
user avatars: u1 #6366f1 · u2 #0ea5e9 · u3 #10b981 · u4 #f59e0b · u5 #ec4899
```
### Typography
- UI: **Hanken Grotesk** (400/450/500/600/650/700). Base 13px, line-height 1.45, letter-spacing -0.005em.
- Mono (issueKey, токены): **IBM Plex Mono** (400/500).
- Шкала: card title 13/500 · column header 12.5/650 · section title 22/700 · panel title 19/650 ·
  meta 11–12 `fg-2/fg-3`.
### Radius / spacing
- radius: cards 11–13, inputs/buttons 8–9, modal 15, login card 16, pills 20.
- column width 312, panel width 480, login card 392, projects max-width 980.
- gaps: columns 14, cards 8, grid 14.
### Shadows: см. `--shadow` (light/dark) + hover `0 2px 10px rgba(20,20,40,.07)`.

## Accent / варианты (tweakable в прототипе)
- **accent:** `#4f46e5` (default), альтернативы `#2563eb`, `#0d9488`, `#7c3aed`, `#ea580c`.
- **cardStyle:** `standard | minimal | detailed` (detailed показывает превью описания).
- **columnFill:** `subtle` (тон колонки) | `plain` (прозрачная).

## Assets
Изображений нет. Все иконки — inline-SVG (lucide-эквиваленты): theme (half-circle), search, plus,
close (X), chevron-left, bell, trash. Аватары — инициалы на цветном круге (детерминированный цвет по
пользователю). Type-chip и priority-bars нарисованы CSS/SVG-примитивами.

## Files
- `Taska.dc.html` — полный hi-fi прототип (все экраны, тема, dnd, фильтры, slide-over, create, notifications).
  Сид-данные и вся логика — в классе `Component` внутри файла; смотрите их как источник правды по
  поведению, истории событий и enum-значениям.
