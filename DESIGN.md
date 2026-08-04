# DESIGN.md — Taska Design System

Единый источник правды по визуалу и поведению UI Taska. Этот файл читает и человек, и агент
(Claude Code / harness) перед тем как писать или менять UI. Если код расходится с этим файлом —
прав файл; если файл устарел — сначала обнови его, потом код.

**Стек-агностично.** Значения даны как CSS-переменные и числа, чтобы лечь в CSS Modules, Tailwind
(`theme.extend`), styled-components или vanilla CSS.

---

## 1. Design principles

1. **Тихий интерфейс.** Хром бледный, контент — контрастный. Цвет несёт смысл (тип, приоритет,
   статус), а не украшает. Максимум один акцент на экране.
2. **Воздух вместо линий.** Разделяем пространством и очень слабыми бордерами (8–9% альфы),
   не жирными рамками и не тенями-«карточками».
3. **Плотность без тесноты.** Base 13px, компактные контролы (24–39px), но щедрые внешние отступы.
4. **Мгновенный отклик.** Любое действие пользователя отражается в UI сразу (оптимистично),
   сеть догоняет. Спиннер — только там, где нечего показать.
5. **Ничего лишнего.** Нет декоративных иллюстраций, эмодзи, градиентных фонов (единственное
   исключение — мягкое radial-свечение на экране логина).
   *Известное нарушение (TAS-142): `.projects-page` несёт второй radial-градиент —
   убрать или узаконить здесь одним решением, а не молчанием.*
6. **Клавиатура — первый класс.** Всё, что кликается, доступно с клавиатуры и имеет focus-стиль.

### Hard rules (нарушать нельзя)
- Не вводить новые цвета «на глаз» — только токены ниже; новый оттенок получать через
  `color-mix(in oklab, <token> N%, transparent)`.
- Не более **двух** фоновых уровней в одной плоскости (`--surface` + `--surface-2`).
- Текст никогда не наследует цвет «случайно»: у текстовых узлов задавать `color` явно
  (`var(--fg)` / `--fg-2` / `--fg-3`).
- Entrance-анимации **не должны скрывать контент**: `fill-mode` и 0%-кадр обязаны оставлять
  элемент читаемым (см. §7).
- Группы (кнопки, чипы, аватары, тулбары) верстать `flex`/`grid` + `gap`, не margin'ами и не
  пробелами в разметке.
- Минимальная кликабельная область — 28×28 (в плотных тулбарах), целевая — 32×32.

---

## 2. Foundations

### 2.1 Color tokens

Тема задаётся набором переменных на корневом элементе приложения. `dark` — переопределение.

```css
:root, [data-theme="light"] {
  --bg:            #f6f6f8;
  --surface:       #ffffff;
  --surface-2:     #f0f0f3;
  --surface-3:     #e9e9ee;
  --border:        rgba(22,22,32,.09);
  --border-strong: rgba(22,22,32,.15);
  --fg:            #17171b;
  --fg-2:          #56565f;
  --fg-3:          #9090a0;
  --accent:        #4f46e5;
  --accent-fg:     #ffffff;
  --shadow:        0 1px 2px rgba(20,20,40,.05), 0 4px 14px rgba(20,20,40,.05);
  --shadow-hover:  0 2px 10px rgba(20,20,40,.07);
  --shadow-pop:    0 12px 40px rgba(10,10,30,.18);
  --shadow-modal:  0 24px 70px rgba(10,10,30,.30);
  --shadow-panel:  -12px 0 40px rgba(10,10,30,.16);
  --scrim:         rgba(12,12,22,.32);
}

[data-theme="dark"] {
  --bg:            #08080b;
  --surface:       #141418;
  --surface-2:     #0f0f13;
  --surface-3:     #1c1c22;
  --border:        rgba(255,255,255,.08);
  --border-strong: rgba(255,255,255,.15);
  --fg:            #ededf1;
  --fg-2:          #9c9ca6;
  --fg-3:          #62626d;
  --accent:        color-mix(in oklab, #4f46e5, white 22%);
  --accent-fg:     #ffffff;
  --shadow:        0 1px 2px rgba(0,0,0,.5), 0 6px 18px rgba(0,0,0,.4);
  --shadow-hover:  0 2px 12px rgba(0,0,0,.5);
  --shadow-pop:    0 12px 40px rgba(0,0,0,.55);
  --shadow-modal:  0 24px 70px rgba(0,0,0,.65);
  --shadow-panel:  -12px 0 40px rgba(0,0,0,.6);
  --scrim:         rgba(4,4,8,.55);
}
```

**Роли:**
| Токен | Где применять |
| --- | --- |
| `--bg` | фон рабочей области (полотно доски, страница) |
| `--surface` | карточки, панели, топбар, поповеры, модалки |
| `--surface-2` | «утопленные» плоскости: колонки доски, контейнеры сегментов, поля ввода в покое, футер модалки |
| `--surface-3` | резерв (наведение на утопленные плоскости) |
| `--border` | разделители и рамки в покое |
| `--border-strong` | рамки инпутов/кнопок, hover-рамка карточки, незалитые priority-бары |
| `--fg` | заголовки и основной текст |
| `--fg-2` | вторичный текст, лейблы, иконки в покое |
| `--fg-3` | подписи, мета, плейсхолдеры, «выключенное» |
| `--accent` | primary-кнопка, активный фильтр, статус In Progress, фокус |

**Акцент — сменный.** Поддерживаемые альтернативы (менять только `--accent`):
`#4f46e5` (default) · `#2563eb` · `#0d9488` · `#7c3aed` · `#ea580c`.

### 2.2 Semantic colors

Не тема-зависимые, работают на обоих фонах.

```css
--type-task:  #4f7cf0;
--type-story: #3fa863;
--type-bug:   #e5544b;

--prio-low:    #9aa0aa;
--prio-medium: #e3a008;
--prio-high:   #e5544b;

--status-todo:        #9aa0aa;
--status-in-progress: var(--accent);
--status-done:        #3fa863;

--danger: #e5544b;
```

**Project key colors** (бейдж проекта): `TAS #6366f1` · `WEB #0ea5e9` · `MOB #8b5cf6` · `OPS #0d9488`.

**Avatar palette** (детерминированно по userId): `#6366f1` `#0ea5e9` `#10b981` `#f59e0b` `#ec4899`.

> Тонированный фон из семантического цвета всегда получаем как
> `color-mix(in oklab, <color> 14%, transparent)` (для бейджей — `16%`), текст — сам `<color>`.

### 2.3 Typography

```css
--font-ui:   'Hanken Grotesk', system-ui, -apple-system, sans-serif;
--font-mono: 'IBM Plex Mono', ui-monospace, monospace;
```
Веса UI: 400 / 450 / 500 / 550 / 600 / 650 / 700. Mono: 400 / 500.
Базово: `font-size:13px; line-height:1.45; letter-spacing:-0.005em`.

| Роль | Размер / вес | Цвет | Трекинг |
| --- | --- | --- | --- |
| Page title (`Projects`) | 22 / 700 | `--fg` | -0.025em |
| Panel title (summary задачи) | 19 / 650 | `--fg` | -0.02em |
| Brand wordmark | 19 / 700 (лого-стр.), 14.5 / 700 (топбар) | `--fg` | -0.02em |
| Section / project name | 14 / 600–650 | `--fg` | -0.015em |
| Column header | 12.5 / 650 | `--fg` | -0.01em |
| Issue card title | 13 / 500 | `--fg` | -0.01em |
| Body / description | 13 / 400, lh 1.55 | `--fg` | — |
| Control label (кнопки, сегменты) | 12–12.5 / 550–600 | по контексту | — |
| Field label | 11.5 / 550 | `--fg-2` | — |
| Meta / caption | 11–11.5 / 400 | `--fg-3` | — |
| Overline (тип задачи) | 10.5 / 400 UPPERCASE | `--fg-3` | 0.04em |
| Mono (issueKey, токен) | 11–12 / 500 | `--fg-3` / `--fg-2` | 0.02em |

Правила: `text-wrap: pretty` для абзацев; одна строка с обрезкой — `white-space:nowrap; overflow:hidden;
text-overflow:ellipsis`; многострочная обрезка — `-webkit-line-clamp` (2 строки на карточках).

### 2.4 Spacing

Шаг 2px, рабочая шкала: `2 4 6 7 8 9 11 13 14 16 18 20 22 26 34`.

| Контекст | Значение |
| --- | --- |
| Gap между колонками доски | 14 |
| Gap между карточками в колонке | 8 |
| Padding полотна доски | 16 / 18 |
| Padding карточки задачи | 12 13 (`standard`), 10 12 (`minimal`) |
| Padding карточки проекта | 17 |
| Padding панели задачи | 20 / 22 |
| Padding модалки | 18 |
| Padding топбара / фильтр-бара | 0 18 |
| Gap в inline-группах контролов | 5–8 |

### 2.5 Radius

| Элемент | Radius |
| --- | --- |
| Pills / count-badge | 20 |
| Иконка-кнопка, сегмент-таб | 6–8 |
| Кнопка, инпут, select | 9 |
| Issue card | 11 |
| Project card, column, поповер | 13 |
| Modal | 15 |
| Login card | 16 |
| Type chip (TASK/STORY) | 4 |
| Type chip (BUG), аватар, status dot | 50% |

### 2.6 Elevation

Только 4 уровня: `--shadow` (карточки, топбар) → `--shadow-hover` (hover карточки) →
`--shadow-pop` (поповер) → `--shadow-modal` (модалка). Больше уровней не вводить.

Slide-over — единственная поверхность с горизонтальной тенью, поэтому у неё отдельный
токен `--shadow-panel` (`-12px 0 40px rgba(10,10,30,.16)`, dark `rgba(0,0,0,.6)`).
Это не пятый уровень, а другая ось; в общую шкалу он не встраивается.

### 2.7 Sizing

| Элемент | Размер |
| --- | --- |
| Топбар | height 52 |
| Фильтр-бар | height 46 |
| Колонка доски | width 312 |
| Issue slide-over | width 480 (max 92vw) |
| Modal | width 480 (max 92vw), отступ сверху 11vh |
| Login card | width 392 (max 90vw) |
| Projects content | max-width 980, центр |
| Кнопка primary/secondary | height 32–34 (в формах 39) |
| Инпут | height 38–42 |
| Иконка-кнопка | 28–34 |
| Сегмент-таб | height 24–30 |
| Аватар | 22 (мета) / 24 (карточка, лента) / 26 (фильтр) / 28 (топбар) |
| Иконки SVG | 11–16 (в основном 13–16), `stroke-width` 1.2–1.7 |

---

## 3. Motion

```css
--ease: cubic-bezier(.2,.7,.3,1);
--dur-hover: 120ms;   /* border-color, box-shadow, opacity, transform на hover */
--dur-enter: 160ms;   /* поповеры, модалки */
--dur-panel: 220ms;   /* slide-over */
```

```css
@keyframes tk-fade { from { opacity:.35 }              to { opacity:1 } }
@keyframes tk-slide{ from { transform:translateX(22px) } to { transform:translateX(0) } }
@keyframes tk-pop  { from { transform:translateY(7px); opacity:.55 } to { transform:translateY(0); opacity:1 } }
```

Правила:
- 0%-кадр **никогда** не `opacity:0` и не `display:none` — иначе контент пропадает при
  паузе анимации (offscreen-рендер, скриншот-тесты, `prefers-reduced-motion`).
- Hover-переходы: `transition: border-color .12s ease, box-shadow .12s ease, transform .12s ease`.
- Уважать `@media (prefers-reduced-motion: reduce)`. Реализовано через сами токены: в
  медиа-запросе `--dur-*` схлопываются в `1ms`, поэтому не нужен ни `!important`, ни
  борьба со специфичностью (см. §1, hard rules). Анимации с литеральной длительностью
  (`.auth-card-wrap`, `.skeleton-card`, `.avatar-loading`) перечислены там же поимённо —
  при добавлении новой литеральной анимации её надо добавить в этот список.
- Никаких bounce/spring и анимаций дольше 250ms. **Единственное исключение** —
  вход карточки логина `.auth-card-wrap` (`tk-pop` 500ms из прототипа): экран
  показывается один раз за сессию и ни с чем не конкурирует. Исключений внутри
  рабочих экранов не бывает.

---

## 4. Components

Спека: назначение → анатомия → размеры/токены → состояния.

### 4.1 Button
- **Primary:** `background:var(--accent); color:var(--accent-fg)`, height 32–34 (форма 39),
  radius 9, padding 0 13–16, 12.5–13.5px/600. С иконкой — `gap:6`, иконка 13.
  hover: `filter:brightness(1.06)`; active: `brightness(.96)`.
- **Secondary / outline:** `border:1px solid var(--border-strong)`, фон прозрачный,
  `color:var(--fg-2)`, hover — `background:var(--surface)` (в футере модалки) или `--surface-2`.
- **Ghost / icon:** без рамки, `color:var(--fg-2)`, размер 28–34, radius 7–9,
  hover: `background:var(--surface-2); color:var(--fg)`.
- **Destructive:** ghost + hover `color:var(--danger)`.
- **Transition button** (в карточке задачи): height 29, padding 0 12, radius 8,
  `border:1px var(--border-strong)`, 12px/550; hover: `border-color/color: var(--accent)`.
- Focus (все): `outline:2px solid var(--accent); outline-offset:2px`.
- Disabled: `opacity:.5; pointer-events:none`.

### 4.2 Segmented control
Контейнер: `display:flex; gap:2–3; padding:2–3; background:var(--surface-2); radius:8–9`.
Кнопка: height 24–30, padding 0 11–12, radius 6–7, 12–12.5px/550–600, `color:var(--fg-2)`.
Активная: `background:var(--surface); color:var(--fg); box-shadow:0 1px 2px rgba(20,20,40,.08–.12)`.
Использование: фильтр типов, Priority, Type/Priority в модалке, табы Sign in / Accept invite
(там таб — `flex:1`, height 30).

### 4.3 Input / Textarea
- Покой: height 38–42, padding 0 12, radius 9, `border:1px var(--border-strong)`,
  фон `--surface` (логин) или `--surface-2` (модалка/описание).
- Focus: `border-color:var(--accent)`; если фон был `--surface-2` → становится `--surface`.
- Placeholder: `color:var(--fg-3)`.
- Label сверху: 11.5px/550 `--fg-2`, `gap:6`.
- **Inline-edit** (summary/description в панели): рамка `transparent` в покое, на focus —
  `border-color:var(--border-strong)` + фон `--surface`; сохранять по debounce (см. §6).
- Textarea: `resize:vertical`, min-height 66–84, lh 1.5–1.55.

### 4.4 Avatar
Круг, `background: <avatar color>`, `color:#fff`, инициалы (2 символа, uppercase),
`font-size: ~40% диаметра`, weight 600. Размеры — см. §2.7.
- **Unassigned:** прозрачный фон, `border:1.5px dashed var(--border-strong)`, без текста.
- **Stack:** `margin-right:-7px`, `border:2px solid var(--surface)`, показывать до 4, далее «+N».
- **Selectable** (фильтр по исполнителю): активный — `outline:2px solid var(--accent);
  outline-offset:1.5px`; неактивные — `opacity:.85`.
- Всегда `title` / `aria-label` с полным именем.

### 4.5 Badge / Pill
- **Project key:** mono 11px/500, padding 4 8, radius 7, letter-spacing .02em,
  фон `color-mix(in oklab, <projectColor> 16%, transparent)`, текст `<projectColor>`.
- **Count pill** (в заголовке колонки): 11px/600 `--fg-3`, `background:var(--surface-2)`,
  padding 1 7, radius 20.
- **Status pill** (в панели): height 28, padding 0 12, radius 8, 12.5px/600,
  фон `color-mix(in oklab, <statusColor> 14%, transparent)`, текст `<statusColor>`.

### 4.6 Type chip
Квадрат 14×14, `radius:4`, фон = цвет типа. **BUG — круг (`radius:50%`)**, чтобы тип читался
без цвета (важно для дальтоников). Рядом всегда текстовая метка типа (overline) или `aria-label`.

### 4.7 Priority indicator
Три бара, ширина 3, высоты 5 / 8 / 11 (снизу выровнены), radius 1, `gap:2`.
Залито `level` штук цветом приоритета, остальные — `--border-strong`.
LOW=1, MEDIUM=2, HIGH=3. Обязателен `title`/`aria-label` («High priority»).

### 4.8 Card
- **Issue card:** `background:var(--surface); border:1px var(--border); radius:11; padding:12 13;
  box-shadow:var(--shadow); cursor:grab`.
  Анатомия: [type chip · issueKey (mono) · тип (overline) · ─── · priority bars] →
  заголовок 13/500 → (опц.) превью описания 2 строки → [дата создания · аватар исполнителя].
  hover: `border-color:var(--border-strong); box-shadow:var(--shadow-hover)`.
  dragging: `opacity:.4`.
- **Project card:** `radius:13; padding:17`, hover `border-strong` + `translateY(-2px)`.
  Анатомия: [key badge · название] → описание → [avatar stack · «N members» ─── «N issues»].

### 4.9 Board column
`width:312; radius:13; padding:11px 9px 4px; display:flex; flex-direction:column`.
Фон: `--surface-2` (вариант `subtle`, по умолчанию) или `transparent` (`plain`).
Заголовок: status dot 8px → имя 12.5/650 `--fg` → count pill → ─── → кнопка «+» (22px).
Список: `flex:1; overflow-y:auto; gap:8`.
**Drag-over:** `box-shadow: inset 0 0 0 2px var(--accent)`.
**Empty:** «Drop issues here» — 11.5px `--fg-3`, `border:1px dashed var(--border-strong)`,
radius 10, padding 18 0.

### 4.10 Slide-over panel
Скрим `var(--scrim)` + `tk-fade`; панель справа: width 480, `background:var(--surface)`,
`border-left:1px var(--border)`, тень слайд-овера, анимация `tk-slide` 220ms `--ease`.
Хедер 52px: type chip · issueKey · тип · ─── · Delete · Close. Тело — скролл.
Закрытие: клик по скриму, Close, `Esc`. Фокус — в панель (focus trap), при закрытии — назад на
инициатор.

### 4.11 Modal
Скрим + центрирование по горизонтали, `padding-top:11vh`. Панель width 480, radius 15,
`box-shadow:var(--shadow-modal)`, анимация `tk-pop`. Хедер (padding 15 18, нижний бордер) ·
тело (18) · футер (13 18, `background:var(--surface-2)`, верхний бордер, кнопки справа `gap:8`).
`Esc` — отмена, `Cmd/Ctrl+Enter` — подтвердить. Клик по скриму закрывает, клик внутри — нет.

### 4.12 Popover (notifications)
width 312, `background:var(--surface); border:1px var(--border); radius:13;
box-shadow:var(--shadow-pop)`, `tk-pop var(--dur-enter)` (160ms — токенизация §3
поглотила прежние 140ms); позиционирование `top:38px; right:0` от триггера.
Хедер: заголовок 13/650 + текстовая кнопка-действие 11.5px/550 `--accent`.
Строка: unread-dot 7px (`--accent`; прочитано — прозрачный круг с `border:1px --border-strong`) +
title 12.5/550 + body 11.5 `--fg-2` + time 10.5 `--fg-3`. Список `max-height:340; overflow:auto`.
Закрытие: `Esc`, клик вне.

### 4.13 Top bar / Filter bar
Top bar: height 52, `background:var(--surface)`, нижний бордер, `padding:0 18`, `gap:12`.
Порядок: назад → project key → название → контекст («Board») → **spacer** → поиск → уведомления →
тема → primary «New».
Filter bar: height 46, тот же фон/бордер, `gap:14`: сегмент типов → разделитель (1×18 `--border`) →
«Assignee» + `All` + аватары → **spacer** → «Clear» (если активны фильтры) → «X of Y».

### 4.14 Search field
height 32, width 220, radius 9, `border:1px var(--border-strong)`, фон `--surface`,
иконка-лупа 14 `--fg-3`, инпут 12.5px. Debounce ввода 200ms.

### 4.15 Comment thread
Живёт в нижней части slide-over, над лентой активности (§4.10). Описывает то,
что отгружено; осознанные отличия-цели вынесены в блокквот ниже.

- **Заголовок секции** 12/600 `--fg-2` UPPERCASE-стиля меты, отступ сверху 24;
  рядом count-pill с количеством.
- **Composer:** `textarea` `min-height:62`, `background:var(--surface-2)`, `radius:10`,
  `padding:9 11`; focus → `border-color:var(--accent)` (фон остаётся `--surface-2`).
  Под ним справа одна primary-кнопка «Comment», `disabled` при пустом теле.
- **Строка комментария:** аватар 24 слева, справа колонка. Шапка: имя 12.5/650 `--fg` +
  время `MMM d, HH:mm` 11px `--fg-3` + пометка «edited» 11px `--fg-3` (без курсива),
  если `updatedAt` не пуст. Тело 12.5px `--fg`, `white-space:pre-wrap`,
  `overflow-wrap:anywhere`.
- **Действия** («Edit», «Delete») — `.link-button` 11.5px `--fg-3`, только автору.
- **Редактирование** — тот же `textarea` на месте тела; «Save» / «Cancel»;
  сохранение по кнопке, не по blur.
- **Пусто / загрузка:** одна строка 12.5px `--fg-3` («No comments yet» /
  «Loading comments»), без иллюстрации.
- **Порядок:** новые сверху; пагинация — кнопка «Load older comments»
  (контракт порядок не специфицирует — см. `docs/ai/API-DIVERGENCE.md`).

Права: комментировать может `ADMIN`/`MEMBER`; редактировать и удалять — только автор
(см. §5.7). `VIEWER` видит тред, но не видит composer.

> **Цели, не реализованные в коде (TAS-142):** «edited» курсивом; тело с
> `line-height:1.55` (сейчас наследует 1.45, при том что description в той же
> панели — 1.55); hover «Delete» → `--danger` (сейчас `.link-button:hover` даёт
> accent обоим действиям); «Cancel» у composer'а.

### 4.16 User profile menu
Поповер под аватаром в правой части топбара, width 276, `radius:13`,
`box-shadow:var(--shadow-pop)`, `tk-pop`. Единственный оверлей, уже
закрывающийся по `Esc` и клику вне.

- Шапка: аватар 34 + имя 13/650 `--fg` (цвет задан явно, §1) + `@login`
  11.5px `--fg-3` (эллипсис).
- Разделитель `1px --border`.
- Тело — `<dl>` пар «Email» / «Status»: `dt` 10.5px `--fg-3`, `dd` 11.5px;
  статус — pill (см. блокквот про его цвета).
- «Log out» — нижний пункт, `--danger` в покое, hover — danger-tinted фон.
- Закрытие: `Esc`, клик вне, выбор пункта.

> **Пробелы (TAS-142):** цвета status-pill (`#22c55e` `#16a34a` `#f59e0b`
> `#d97706`) захардкожены в `styles.css` вопреки §8 — вынести в
> `src/lib/format.ts`. Резолв против §4.1: «Log out» с `--danger` в покое —
> осознанное отклонение от ghost→hover-danger или приводить к §4.1 — решить
> при TAS-142.

### 4.17 Theme toggle
Иконка-кнопка (half-filled circle): круг r=6 `stroke:currentColor`, залитая левая половина.
Хранить выбор в `localStorage` (ключ `taska.theme`), инициализировать до первой отрисовки
(инлайн-скрипт в `<head>`), уважать `prefers-color-scheme` при первом визите.

---

## 5. Patterns

### 5.1 App shell и маршруты
Фиксированный топбар (+ фильтр-бар на доске) → прокручиваемая область контента.
`height:100vh; display:flex; flex-direction:column; overflow:hidden`; скроллит только контент.

| Экран | Route |
| --- | --- |
| Login / Accept invite | `/login`, `/invite?token=…` |
| Projects | `/projects` |
| Board | `/projects/:projectId/board` |
| Issue card | `/projects/:projectId/issues/:issueId` |
| Notifications | поповер, без маршрута |

Issue card — **slide-over поверх доски**, а не отдельная страница: URL меняется,
доска остаётся под затемнением, закрытие панели возвращает на `…/board`.
Ручки для каждого экрана — в контракте `docs/contract/openapi.yml`.

### 5.2 Board layout
Полотно `flex; gap:14; overflow-x:auto; align-items:flex-start`, колонки во всю высоту,
внутренний скролл — у списка карточек, не у полотна.

### 5.3 Drag & drop
- Источник — карточка задачи; цель — колонка (в MVP порядок внутри колонки не сохраняем).
- `dragstart` → запомнить `issueId`, `effectAllowed='move'`; `dragover` на колонке →
  `preventDefault()` + подсветка; `drop` → переход статуса; `dragend` → сбросить состояние.
- Обновление **оптимистичное**: карточка сразу в новой колонке, затем `POST …/transitions`;
  при ошибке — вернуть назад + тост.
- Клавиатурная альтернатива обязательна: transition-кнопки в карточке задачи.
- Библиотека по умолчанию — `@dnd-kit/core`.

### 5.4 Filtering
Фильтры комбинируются по AND: `type` + `assignee` + текстовый `q` (по `summary` и `issueKey`,
case-insensitive). «Clear» показывается только когда что-то активно. Счётчик «X of Y» —
всегда. Серверные фильтры (`status`, `assigneeId`) отдавать в `GET /issues`, поиск —
локально по загруженной странице (пока нет серверного).

### 5.5 Inline editing
Заголовок и описание задачи редактируются на месте (без «режима правки»): изменение → локальный
стейт сразу → `PATCH` с debounce 600ms → в ленте активности появляется событие. Ошибка → откат
значения + тост.

### 5.6 Empty / loading / error
- **Loading:** скелетоны формой конечного элемента (карточки колонок, строки списка), фон
  `--surface-2`, пульсация `opacity .35→1`. Спиннеров в контенте не использовать.
- **Empty:** одна строка 11.5–12px `--fg-3` в пунктирной рамке (колонка) или короткий текст +
  primary-действие (список проектов).
- **Error:** тост снизу справа: `background:var(--surface); border:1px var(--border);
  radius:11; box-shadow:var(--shadow-pop)`, текст 12.5px, акцент-полоса/иконка `--danger`.
  Показывать `error.message`, `error.requestId` — мелким `--fg-3` (копируемым).

> **Пробел (TAS-140).** Тост-компонента в коде нет. Ошибки показываются только инлайном
> (`.form-error` на формах логина и создания задачи), а `requestId` не доходит до
> пользователя вообще. Это значит, что откаты оптимистичных мутаций (§5.3, §5.5) сейчас
> происходят молча: карточка возвращается в исходную колонку без единого объяснения.
> Требование выше — правильное, поэтому оно оставлено как есть, а не подогнано под код.
> Спецификация тоста — контракт для будущей реализации, а не описание текущего состояния.

### 5.7 Permissions
Роль берём из `GET /projects/{id}/membership`. `VIEWER` — только чтение: скрывать «New»,
transition-кнопки, Delete, drag (`draggable=false`), инлайн-редактирование (readOnly),
composer комментариев.
Не полагаться только на скрытие — сервер всё равно проверяет.

Комментарии гейтятся **двумя** правилами, не одним: создание — по роли
(`ADMIN`/`MEMBER`), редактирование и удаление — по авторству (`comment.authorUserId ===
currentUser.id`). Роль `ADMIN` не даёт права править чужой комментарий.

> **Внимание при проверке прав.** В режиме `hybrid` с
> `VITE_TASKA_ASSUME_PROJECT_ADMIN=true` роль синтезируется на клиенте и всегда `ADMIN`
> (см. §6, «Режимы API» и `docs/ai/API-DIVERGENCE.md`). Прошедшая в этом режиме проверка
> ролевого гейтинга не доказывает ничего: `VIEWER` в нём просто недостижим.

---

## 6. Data & state conventions

### Enums (ровно как в REST-контракте, без proto-префиксов)
```ts
type UserStatus    = 'INVITED' | 'ACTIVE' | 'BLOCKED';
type ProjectRole   = 'ADMIN' | 'MEMBER' | 'VIEWER';
type IssueType     = 'TASK' | 'BUG' | 'STORY';
type IssuePriority = 'LOW' | 'MEDIUM' | 'HIGH';
type IssueStatus   = 'TODO' | 'IN_PROGRESS' | 'DONE';
type IssueEventType =
  | 'CREATED' | 'TRANSITIONED' | 'ASSIGNED' | 'PRIORITY' | 'UPDATED' | 'DELETED'
  | 'COMMENT_CREATED' | 'COMMENT_UPDATED' | 'COMMENT_DELETED';
```
Комментарий (`IssueComment`): `id`, `issueId`, `projectId`, `authorUserId`, `body`,
`createdAt`, `updatedAt` (`null`, пока не редактировали — по нему и рисуется пометка
«edited»), `version`.
Отображаемые названия статусов: `TODO → "To Do"`, `IN_PROGRESS → "In Progress"`, `DONE → "Done"`.
Названия типов: `Task` / `Bug` / `Story`. Приоритеты: `Low` / `Medium` / `High`
(в узких сегментах — `Med`).

### Формат данных
- Идентификаторы — UUID-строки; в UI показываем `issueKey` (`ABC-123`), а не id.
- Время — ISO-8601 UTC; в UI: на карточке `MMM d` («Jun 25»), в мете/ленте `MMM d, HH:mm` (24ч),
  в уведомлениях — относительное («2h ago», «Yesterday»).
- Enum-значения не локализуем в данных, только при выводе.

### State layering
| Слой | Что | Где |
| --- | --- | --- |
| session | currentUser, accessToken/refresh | auth-контекст + `GET /users/me` |
| route | projectId, issueId | URL (§7 handoff README) |
| server | projects, membership, workflow, issues, issue+history, comments, notifications | react-query, мутации оптимистичные + инвалидация |
| board ui | `{ q, type, assignee }`, dragIssueId, dragOverStatus | локальный стейт экрана |
| app ui | theme, notifOpen, creating, draft, editingCommentId | локальный стейт / контекст, theme persist |

Правило: **никогда** не дублировать серверные данные в локальном стейте — только id и ui-флаги.

Исключение — черновики инлайн-редактирования (summary/description задачи, тело
комментария). Их приходится держать локально, потому что пользователь печатает быстрее,
чем отвечает сеть. Пересев с серверного значения делается **на рендере**, а не в
`useEffect`: эффект стоит лишний проход рендера на каждом рефетче, а сброс через `key`
сбивает фокус посреди набора текста. Для строки комментария `key` наоборот уместен — там
переключение в режим правки и должно пересоздавать черновик.

### Режимы API
`VITE_TASKA_API_MODE`: `mock` (полностью в памяти) · `rest` (только гейтвей) ·
`hybrid` (по умолчанию). Переключение — в `src/api/client.ts`, общий контракт —
`src/api/TaskaApi.ts`.

`hybrid` существует только потому, что `TAS-137` ещё не задеплоен: membership и список
участников синтезируются на клиенте из `GET /projects/{id}` и `GET /users/me`. Следствие
для UI — **в проекте виден ровно один участник**, текущий пользователь, независимо от
того, сколько их на самом деле. Фильтр по исполнителю и чипы assignee в этом режиме не
могут предложить никого другого.

Полный разбор — `docs/ai/API-DIVERGENCE.md`. Когда `TAS-137` выедет, `HybridTaskaApi`
удаляется целиком, а режим по умолчанию становится `rest`.

---

## 7. Accessibility

> **Записанные разрывы с кодом (TAS-142), найдены ревью art-director 2026-08-03.**
> Требования ниже остаются контрактом; здесь — честный список того, что им пока
> не соответствует, чтобы документ не читался как описание текущего состояния:
> - `Esc` закрывает только меню профиля. Slide-over, модалка создания и поповер
>   уведомлений его игнорируют; поповер не закрывается и по клику вне.
> - У slide-over нет `role="dialog"`/`aria-modal`, focus trap и возврата фокуса —
>   за открытой панелью в tab-порядке остаются десятки элементов. У модалки роль
>   есть, trap нет.
> - `:focus-visible` реализован только в меню профиля; остальной продукт — на
>   дефолтном браузерном outline вместо `2px var(--accent)`.
> - Триггер уведомлений без `aria-expanded` и счётчика в имени; фильтр
>   исполнителя без `aria-pressed`; непрочитанность — только цветом.
> - Контрасты ниже порогов: status-pill по рецепту §4.5 — 1.91:1 для `TODO`;
>   неактивные сегмент-табы (`--fg-3` вместо `--fg-2` из §4.2) — 2.76:1.
> - Touch-таргеты на 390px меньше 44×44 (колоночный «+» — 22px; здесь §7
>   противоречит §4.9 — решить в доке при закрытии TAS-142).

- Контраст: основной текст ≥ 7:1, вторичный ≥ 4.5:1, `--fg-3` использовать только для
  некритичной меты (≥ 3:1). Проверять оба режима.
- Цвет никогда не единственный носитель смысла: тип — цвет + форма чипа + текст; приоритет —
  количество баров + `title`; статус — колонка + подпись.
- Focus-visible на всём интерактивном: `outline:2px solid var(--accent); outline-offset:2px`.
- Slide-over и модалка: `role="dialog"`, `aria-modal="true"`, focus trap, `Esc` закрывает,
  возврат фокуса на триггер.
- Поповер уведомлений: `aria-expanded` на триггере, счётчик непрочитанных в `aria-label`.
- Иконки-кнопки без текста — обязателен `aria-label`.
- Drag & drop дублируется кнопками переходов (клавиатурный путь).
- Мин. область нажатия 28×28 (плотный тулбар) / 32×32 (обычные), на тач-макетах — 44×44.
- Уважать `prefers-reduced-motion`.

---

## 8. Code conventions for UI

### Фактическая структура

Раздел описывает то, что есть в репозитории, а не то, к чему стоило бы прийти.
Если появляется новый файл — он встаёт в одну из этих папок.

```
src/
  screens/      App, LoginScreen, ProjectsScreen, BoardScreen — экраны и их состояние
  components/   переиспользуемые куски UI: Avatar, Modal, ThemeToggle,
                UserProfileMenu, TaskaLogo, IssueBits (type-chip, priority-bars)
  api/          TaskaApi (контракт) + mock/ · rest/ · HybridTaskaApi + client.ts
  domain/       types.ts — enum'ы и модели ровно по REST-контракту
  hooks/        useTheme
  lib/          format.ts — форматирование дат и семантические константы §2.2
  test/         setup.ts для vitest
  styles.css    один глобальный файл со всеми классами
```

Стили — **один глобальный `src/styles.css`** с плоскими именами классов
(`.issue-card`, `.comment-item`, `.board-column`). Не CSS Modules, не Tailwind,
не styled-components. Токены §2 объявлены на `:root` там же.

**Известный долг.** `BoardScreen.tsx` — около 1200 строк: доска, фильтр-бар,
slide-over задачи, тред комментариев, модалка создания и поповер уведомлений живут
в одном файле. Разносить по одному компоненту в файл имеет смысл при следующей
крупной правке доски; специально под это отдельную задачу пока не заводили.
Записано как долг, а не выдано за архитектуру.

- **Один компонент — один файл** для всего нового кода; имя файла = имя компонента.
- **Токены только через переменные.** Хардкод hex в компонентах запрещён, кроме семантических
  констант из §2.2 — они объявлены в одном месте, `src/lib/format.ts`
  (`statusColors`, `typeMeta`, `priorityMeta`).
- Тема — атрибут `data-theme` на `<html>`; не использовать классы `.dark` вперемешку с media-query.
- Не создавать вариант компонента ради одного отличия — прокидывать проп (`size`, `tone`, `variant`).
- Иконки — один набор (`lucide-react` или локальные inline-SVG), `stroke-width` 1.2–1.7,
  `currentColor`, размеры кратны шагу из §2.7. Не смешивать наборы.
- Списки: `key` = доменный id (`issue.id`), не индекс.
- Никаких инлайн-`!important`; специфичность решаем структурой.
- Числа-магии в вёрстке допустимы только из шкал §2.4/2.5/2.7.

---

## 9. Reference

Порядок приоритета источников задан в `AGENTS.md`:
`openapi.yml` бэкенда → `DESIGN.md` → задача в Jira → `docs/ai/REFERENCE-LOCK.md`
→ `AGENTS.md`. Фронт подстраивается под бэк, не наоборот.

- REST-контракт (источник enum'ов, ручек и кодов ошибок), верхний источник:
  `openapi.yml` из репозитория бэкенда, снапшот — `docs/contract/openapi.yml`.
  Поведение задеплоенного гейтвея может отличаться и от него — расхождения и
  молчания контракта ведутся в `docs/ai/API-DIVERGENCE.md`.
- Исходный дизайн-хендофф (hi-fi прототип `Taska.dc.html`, его README и REST-черновик,
  написанный до появления гейтвея) **поглощён этим документом** и удалён из рабочего
  дерева; при необходимости он доступен в истории git. Всё, что в нём было
  нормативного — токены, компоненты, поведение, маршруты, — живёт здесь.
- Внешние дизайн-референсы (Refero MCP) ограничены `docs/ai/REFERENCE-LOCK.md` и стоят
  **ниже** этого документа: референс может обострить критику, но не может ввести токен
  или паттерн, противоречащий §2.

### Варианты, зафиксированные в прототипе
| Вариант | Значения | По умолчанию |
| --- | --- | --- |
| accent | `#4f46e5` `#2563eb` `#0d9488` `#7c3aed` `#ea580c` | `#4f46e5` |
| cardStyle | `standard` · `minimal` (компактнее) · `detailed` (+2 строки описания) | `standard` |
| columnFill | `subtle` (тон колонки) · `plain` (прозрачная) | `subtle` |

---

## 10. Definition of done для UI-задачи

1. Совпадает с прототипом по токенам §2 (цвета, типографика, отступы, радиусы, тени).
2. Работает в светлой и тёмной теме; контраст проверен в обеих.
3. Есть состояния: loading (скелетон), empty, error (тост с `requestId`), disabled, focus, hover.
4. Клавиатурная доступность: tab-порядок, focus-visible, `Esc` для оверлеев, альтернатива drag'у.
5. Права по роли (`VIEWER` — read-only) учтены в UI.
6. Мутации оптимистичные, с откатом и тостом при ошибке.
7. `prefers-reduced-motion` уважается; entrance-анимации не скрывают контент.
8. Нет хардкод-цветов и магических отступов вне шкал.
