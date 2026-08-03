# Taska API Gateway REST draft

Черновой REST-контракт для фронтенд-макета Taska. Документ описывает ручки, которые API Gateway/BFF может дать поверх текущих gRPC-контрактов.

Статусы покрытия:

| Статус | Значение |
| --- | --- |
| `gRPC-backed` | Уже есть соответствующий gRPC-метод или почти прямое соответствие. |
| `gateway-composed` | Можно собрать в gateway из нескольких gRPC-вызовов или JWT claims. |
| `proposed` | Для фронта ручка нужна, но текущего gRPC-метода пока нет. |

## Общие правила

Base path: `/api/v1`

Формат JSON: `camelCase`.

Идентификаторы: UUID в строковом виде.

Время: ISO-8601 UTC, например `2026-06-25T10:15:30Z`.

Enum-значения в REST используются без proto-префиксов:

| Модель | Значения |
| --- | --- |
| `UserStatus` | `INVITED`, `ACTIVE`, `BLOCKED` |
| `ProjectRole` | `ADMIN`, `MEMBER`, `VIEWER` |
| `IssueType` | `TASK`, `BUG`, `STORY` |
| `IssuePriority` | `LOW`, `MEDIUM`, `HIGH` |
| `IssueStatus` | `TODO`, `IN_PROGRESS`, `DONE` |
| `NotificationType` | `ISSUE_ASSIGNED`, `ISSUE_TRANSITIONED`, `ISSUE_CREATED`, `ISSUE_UPDATED`, `ISSUE_DELETED`, `USER_INVITED`, `USER_ACTIVATED`, `PROJECT_CREATED`, `MEMBER_ADDED`, `MEMBER_REMOVED`, `MEMBER_ROLE_CHANGED` |

Заголовки:

| Header | Обязателен | Описание |
| --- | --- | --- |
| `Authorization: Bearer <accessToken>` | Да, кроме публичных auth-ручек | JWT access token. Gateway валидирует подпись и срок действия. |
| `X-Request-Id` | Нет | Если не передан, gateway генерирует сам и кладет в gRPC `Header.request_id`. |
| `Idempotency-Key` | Желательно для `POST` | Рекомендуемое расширение для безопасного повтора создания ресурсов. В issue-service уже есть таблица idempotency keys, но REST/gRPC-поведение пока не оформлено. |

Gateway не должен принимать `actorUserId`, `reporterId`, `createdBy` и подобные поля из тела REST-запроса. Эти значения нужно брать из JWT `sub`/`userId` и прокидывать в gRPC как текущего пользователя.

## Ошибки

Рекомендуемый формат ошибки:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Issue not found",
    "requestId": "9d0fc39f-7a09-4f2a-a5f8-7fd23c65c1a6"
  }
}
```

Маппинг доменных статусов уже описан в `DomainStatus`:

| DomainStatus | HTTP |
| --- | --- |
| `NOT_FOUND` | `404` |
| `ALREADY_EXISTS` | `409` |
| `INVALID_ARGUMENT` | `400` |
| `FAILED_PRECONDITION` | `400` |
| `PERMISSION_DENIED` | `403` |
| `UNAUTHENTICATED` | `401` |
| `RESOURCE_EXHAUSTED` | `429` |
| `UNAVAILABLE` | `503` |
| `DEADLINE_EXCEEDED` | `504` |
| `ABORTED` | `409` |
| `UNIMPLEMENTED` | `501` |
| `INTERNAL`, `UNKNOWN`, `DATA_LOSS` | `500` |

## Auth

### `POST /api/v1/auth/login`

Статус: `gRPC-backed` через `AuthService.Login`.

Публичная ручка входа.

Request:

```json
{
  "email": "anna@example.com",
  "password": "CorrectHorse123!"
}
```

Response `200`:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "raw-refresh-token",
  "expiresIn": 3600
}
```

UI-состояния:

| Код | Когда |
| --- | --- |
| `401` | Неверные учетные данные, пользователь `INVITED`/`BLOCKED`, refresh/access token невалиден. |
| `400` | Email или password не переданы. |

### `POST /api/v1/auth/refresh`

Статус: `gRPC-backed` через `AuthService.Refresh`.

Публичная ручка ротации refresh token.

Request:

```json
{
  "refreshToken": "raw-refresh-token"
}
```

Response `200`:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "new-raw-refresh-token",
  "expiresIn": 3600
}
```

### `POST /api/v1/auth/invitations/accept`

Статус: `gRPC-backed` через `AuthService.SetPasswordByToken`.

Публичная ручка активации приглашенного пользователя.

Request:

```json
{
  "token": "invite-token-from-email",
  "newPassword": "CorrectHorse123!"
}
```

Response `204`: без тела.

UI-состояния:

| Код | Когда |
| --- | --- |
| `400` | Пароль не проходит password policy. |
| `401` | Invite token невалиден, истек или уже использован. |

### `GET /api/v1/users/me`

Статус: `gateway-composed`.

Нужна фронту для восстановления сессии после reload. Минимально gateway может собрать ответ из JWT claims (`sub`, `login`, `email`). Для `displayName` и `status` нужен отдельный gRPC user-profile метод, которого пока нет.

Response `200`:

```json
{
  "id": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
  "login": "anna",
  "email": "anna@example.com",
  "displayName": "Anna Ivanova",
  "status": "ACTIVE"
}
```

## Admin users

### `POST /api/v1/admin/users/invitations`

Статус: `gRPC-backed` через `AdminInviteUserService.InviteUser`.

Создает пользователя в статусе `INVITED`, генерирует invite token и публикует событие `USER_INVITED`.

Request:

```json
{
  "email": "new.user@example.com",
  "displayName": "New User"
}
```

Response `201`:

```json
{
  "userId": "d3f5ff33-1f23-4b73-b458-5f1382295783",
  "status": "INVITED"
}
```

Открытый вопрос: в текущих контрактах нет глобальных ролей администратора. Для UI можно считать, что эта ручка доступна пользователю с будущей системной ролью `ADMIN`.

### `GET /api/v1/users?query={query}&status={status}&page={page}&pageSize={pageSize}`

Статус: `proposed`.

Нужна для поиска пользователей при добавлении в проект и назначении исполнителя. Сейчас в auth-service нет gRPC-метода поиска пользователей.

Query params:

| Param | Тип | Описание |
| --- | --- | --- |
| `query` | string | Поиск по email/login/displayName. |
| `status` | UserStatus | Опционально, например только `ACTIVE`. |
| `page` | int | Номер страницы с 0. |
| `pageSize` | int | Размер страницы. |

Response `200`:

```json
{
  "items": [
    {
      "id": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
      "login": "anna",
      "email": "anna@example.com",
      "displayName": "Anna Ivanova",
      "status": "ACTIVE"
    }
  ],
  "page": 0,
  "pageSize": 20,
  "totalCount": 1
}
```

## Projects

### `GET /api/v1/projects`

Статус: `gRPC-backed` через `ProjectService.ListMyProjects`.

Возвращает проекты текущего пользователя. `userId` берется из JWT.

Response `200`:

```json
{
  "items": [
    {
      "id": "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e",
      "projectKey": "ABC",
      "name": "Alpha Backlog",
      "createdBy": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
      "createdAt": "2026-06-25T10:15:30Z",
      "updatedAt": "2026-06-25T10:15:30Z",
      "archivedAt": null
    }
  ]
}
```

### `POST /api/v1/projects`

Статус: `gRPC-backed` через `ProjectService.CreateProject`.

Создает проект. Создатель автоматически становится `ADMIN`.

Request:

```json
{
  "projectKey": "ABC",
  "name": "Alpha Backlog"
}
```

Response `201`:

```json
{
  "id": "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e",
  "projectKey": "ABC",
  "name": "Alpha Backlog",
  "createdBy": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
  "createdAt": "2026-06-25T10:15:30Z",
  "updatedAt": "2026-06-25T10:15:30Z",
  "archivedAt": null
}
```

Ошибки:

| Код | Когда |
| --- | --- |
| `409` | `projectKey` уже занят. |

### `GET /api/v1/projects/{projectId}`

Статус: `gRPC-backed` через `ProjectService.GetProject`.

Response `200`: `Project`.

### `GET /api/v1/projects/{projectId}/membership`

Статус: `gRPC-backed` через `ProjectService.CheckProjectMemberRole`.

Проверяет роль текущего пользователя в проекте. Полезно для UI, чтобы скрывать или блокировать действия.

Response `200`:

```json
{
  "role": "ADMIN",
  "isMember": true,
  "projectExists": true
}
```

### `GET /api/v1/projects/{projectId}/members`

Статус: `proposed`.

Нужна для настроек проекта, assignee picker и отображения людей на карточках. Сейчас есть gRPC только для add/remove/change/check, но нет list.

Response `200`:

```json
{
  "items": [
    {
      "userId": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
      "role": "ADMIN",
      "addedAt": "2026-06-25T10:15:30Z",
      "addedBy": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
      "user": {
        "displayName": "Anna Ivanova",
        "email": "anna@example.com"
      }
    }
  ]
}
```

Поле `user` можно сделать опциональным. Для него нужен user-profile lookup в auth-service.

### `POST /api/v1/projects/{projectId}/members`

Статус: `gRPC-backed` через `ProjectService.AddProjectMember`.

Request:

```json
{
  "userId": "e65186a2-b807-42ae-a66f-711be116a93b",
  "role": "MEMBER"
}
```

Response `201`:

```json
{
  "userId": "e65186a2-b807-42ae-a66f-711be116a93b",
  "projectId": "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e",
  "role": "MEMBER"
}
```

Ошибки:

| Код | Когда |
| --- | --- |
| `409` | Пользователь уже участник проекта. |

### `PATCH /api/v1/projects/{projectId}/members/{userId}`

Статус: `gRPC-backed` через `ProjectService.ChangeProjectMemberRole`.

Request:

```json
{
  "role": "VIEWER"
}
```

Response `200`:

```json
{
  "userId": "e65186a2-b807-42ae-a66f-711be116a93b",
  "projectId": "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e",
  "role": "VIEWER"
}
```

### `DELETE /api/v1/projects/{projectId}/members/{userId}`

Статус: `gRPC-backed` через `ProjectService.RmProjectMember`.

Response `200`:

```json
{
  "userId": "e65186a2-b807-42ae-a66f-711be116a93b",
  "projectId": "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e"
}
```

## Issues

Права из текущего `issue-service`:

| Действие | Роли |
| --- | --- |
| Создание | `ADMIN`, `MEMBER` |
| Изменение | `ADMIN`, `MEMBER` |
| Назначение исполнителя | `ADMIN`, `MEMBER` |
| Удаление | `ADMIN`, `MEMBER` |
| Просмотр карточки | `ADMIN`, `MEMBER`, `VIEWER` |
| Просмотр списка | `ADMIN`, `MEMBER`, `VIEWER` |

### `GET /api/v1/projects/{projectId}/issues`

Статус: `gRPC-backed` через `IssueService.ListIssues`.

Query params:

| Param | Тип | Описание |
| --- | --- | --- |
| `status` | IssueStatus | Опционально. |
| `assigneeId` | UUID | Опционально. |
| `page` | int | Номер страницы с 0. Если меньше 0, сервис использует 0. |
| `pageSize` | int | По умолчанию 20, максимум 100. |

Текущая сортировка в issue-service: `createdAt ASC`.

Response `200`:

```json
{
  "items": [
    {
      "id": "2a16c59a-3ee7-49a6-b07a-5d8096c6c7e8",
      "issueKey": "ABC-123",
      "summary": "Fix login form validation",
      "issueType": "BUG",
      "priority": "HIGH",
      "assigneeId": "e65186a2-b807-42ae-a66f-711be116a93b"
    }
  ],
  "page": 0,
  "pageSize": 20,
  "totalCount": 1
}
```

### `POST /api/v1/projects/{projectId}/issues`

Статус: `gRPC-backed` через `IssueService.CreateIssue`.

`reporterId` берется из JWT.

Request:

```json
{
  "issueType": "TASK",
  "summary": "Prepare onboarding checklist",
  "description": "Checklist for invited users.",
  "priority": "MEDIUM"
}
```

Response `201`:

```json
{
  "id": "2a16c59a-3ee7-49a6-b07a-5d8096c6c7e8",
  "projectId": "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e",
  "issueNumber": 123,
  "issueKey": "ABC-123",
  "issueType": "TASK",
  "summary": "Prepare onboarding checklist",
  "description": "Checklist for invited users.",
  "status": "TODO",
  "priority": "MEDIUM",
  "assigneeId": null,
  "reporterId": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
  "createdAt": "2026-06-25T10:15:30Z",
  "updatedAt": "2026-06-25T10:15:30Z",
  "version": 1,
  "deletedAt": null
}
```

### `GET /api/v1/projects/{projectId}/issues/{issueId}`

Статус: `gRPC-backed` через `IssueService.GetIssue`.

Возвращает задачу и историю изменений. История ограничена настройкой `issue.card.max-history-size`, сейчас по умолчанию 50.

Response `200`:

```json
{
  "issue": {
    "id": "2a16c59a-3ee7-49a6-b07a-5d8096c6c7e8",
    "projectId": "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e",
    "issueNumber": 123,
    "issueKey": "ABC-123",
    "issueType": "TASK",
    "summary": "Prepare onboarding checklist",
    "description": "Checklist for invited users.",
    "status": "TODO",
    "priority": "MEDIUM",
    "assigneeId": null,
    "reporterId": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
    "createdAt": "2026-06-25T10:15:30Z",
    "updatedAt": "2026-06-25T10:15:30Z",
    "version": 1,
    "deletedAt": null
  },
  "history": [
    {
      "id": "5a46f702-9d86-4f3b-a5b0-3e1b7074a1fb",
      "issueId": "2a16c59a-3ee7-49a6-b07a-5d8096c6c7e8",
      "eventType": "CREATED",
      "actorUserId": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
      "occurredAt": "2026-06-25T10:15:30Z",
      "payload": {}
    }
  ]
}
```

Примечание: в gRPC поле называется `status_key`, в REST лучше отдать `status`.

### `PATCH /api/v1/projects/{projectId}/issues/{issueId}`

Статус: `gRPC-backed` через `IssueService.UpdateIssue`.

Обновляет summary, description, priority.

Request:

```json
{
  "summary": "Prepare onboarding checklist",
  "description": "Checklist for invited users and project admins.",
  "priority": "HIGH"
}
```

Response `200`:

```json
{
  "id": "2a16c59a-3ee7-49a6-b07a-5d8096c6c7e8",
  "summary": "Prepare onboarding checklist",
  "description": "Checklist for invited users and project admins.",
  "priority": "HIGH"
}
```

### `PUT /api/v1/projects/{projectId}/issues/{issueId}/assignee`

Статус: `gRPC-backed` через `IssueService.AssignIssue`.

Request:

```json
{
  "assigneeId": "e65186a2-b807-42ae-a66f-711be116a93b"
}
```

Response `200`: полная модель `Issue`.

Ограничение текущей реализации: assignee тоже должен иметь роль из набора `ADMIN`, `MEMBER` в этом проекте.

### `DELETE /api/v1/projects/{projectId}/issues/{issueId}`

Статус: `gRPC-backed` через `IssueService.DeleteIssue`.

Мягкое удаление. После удаления задача не участвует в выдаче списка.

Response `200`:

```json
{
  "deletedIssueId": "2a16c59a-3ee7-49a6-b07a-5d8096c6c7e8",
  "eventType": "DELETED"
}
```

### `POST /api/v1/projects/{projectId}/issues/{issueId}/transitions`

Статус: `proposed`.

Нужна для drag-and-drop на доске и кнопок перехода в карточке задачи. В proto есть событие `ISSUE_EVENT_TYPE_TRANSITIONED`, но нет gRPC-метода перехода статуса.

Request:

```json
{
  "transitionId": "55555555-5555-5555-5555-555555555555"
}
```

Альтернатива для простого UI:

```json
{
  "toStatus": "IN_PROGRESS"
}
```

Response `200`:

```json
{
  "id": "2a16c59a-3ee7-49a6-b07a-5d8096c6c7e8",
  "status": "IN_PROGRESS",
  "version": 2,
  "updatedAt": "2026-06-25T10:20:30Z"
}
```

Рекомендуемые проверки backend:

| Проверка | Ошибка |
| --- | --- |
| Проект существует, пользователь участник | `404` или `403` |
| Переход существует в workflow и не hidden | `400` или `404` |
| `fromStatus` задачи совпадает с переходом | `409` |
| Валидаторы перехода выполнены | `400` |

## Workflow and board

### `GET /api/v1/projects/{projectId}/workflow?issueType={issueType}`

Статус: `gRPC-backed` через `WorkflowService.GetWorkflowForProject`.

Нужна для колонок доски и списка доступных переходов.

Response `200`:

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "name": "Default workflow",
  "version": 1,
  "createdAt": "2026-06-25T10:15:30Z",
  "updatedAt": "2026-06-25T10:15:30Z",
  "statuses": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "statusKey": "TODO",
      "name": "To Do",
      "category": "TODO",
      "sortOrder": 10
    },
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "statusKey": "IN_PROGRESS",
      "name": "In Progress",
      "category": "IN_PROGRESS",
      "sortOrder": 20
    },
    {
      "id": "44444444-4444-4444-4444-444444444444",
      "statusKey": "DONE",
      "name": "Done",
      "category": "DONE",
      "sortOrder": 30
    }
  ],
  "transitions": [
    {
      "id": "55555555-5555-5555-5555-555555555555",
      "fromStatusId": "22222222-2222-2222-2222-222222222222",
      "toStatusId": "33333333-3333-3333-3333-333333333333",
      "name": "Start Progress",
      "sortOrder": 10
    }
  ]
}
```

Открытый вопрос: seed сейчас привязывает default workflow к project id `00000000-0000-0000-0000-000000000000`. Для реальных проектов нужен либо fallback на default workflow, либо создание bindings при создании проекта.

### `GET /api/v1/projects/{projectId}/board?issueType={issueType}&assigneeId={assigneeId}`

Статус: `gateway-composed`.

UI-friendly BFF-ручка для доски. Gateway может вызвать workflow и список задач, затем разложить задачи по колонкам. Это необязательно для MVP, но сильно упрощает фронтенд.

Response `200`:

```json
{
  "projectId": "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e",
  "workflowId": "11111111-1111-1111-1111-111111111111",
  "columns": [
    {
      "status": "TODO",
      "name": "To Do",
      "sortOrder": 10,
      "issues": [
        {
          "id": "2a16c59a-3ee7-49a6-b07a-5d8096c6c7e8",
          "issueKey": "ABC-123",
          "summary": "Prepare onboarding checklist",
          "issueType": "TASK",
          "priority": "MEDIUM",
          "assigneeId": null
        }
      ],
      "totalCount": 1
    }
  ]
}
```

## Notifications

### `GET /api/v1/notifications`

Статус: `gRPC-backed` через `NotificationService.ListNotifications`.

`userId` берется из JWT.

Query params:

| Param | Тип | Описание |
| --- | --- | --- |
| `unreadOnly` | boolean | Если `true`, только непрочитанные. |
| `pageSize` | int | По умолчанию 20, максимум 100. |
| `offset` | int | Смещение от начала списка. Если меньше 0, используется 0. |

Текущая сортировка: `createdAt DESC`.

Response `200`:

```json
{
  "items": [
    {
      "id": "7a9cc6a5-9807-4d19-8016-cd39b1b571e2",
      "userId": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
      "notificationType": "ISSUE_ASSIGNED",
      "title": "Issue assigned",
      "body": "ABC-123 was assigned to you",
      "link": "/projects/ABC/issues/ABC-123",
      "createdAt": "2026-06-25T10:15:30Z",
      "readAt": null,
      "sourceEventId": "7f7fa6c4-29f8-43f4-9471-7755e035f557"
    }
  ],
  "pageSize": 20,
  "offset": 0
}
```

### `PATCH /api/v1/notifications/{notificationId}/read`

Статус: `gRPC-backed` через `NotificationService.MarkAsRead`.

Response `200`:

```json
{
  "id": "7a9cc6a5-9807-4d19-8016-cd39b1b571e2",
  "userId": "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6",
  "notificationType": "ISSUE_ASSIGNED",
  "title": "Issue assigned",
  "body": "ABC-123 was assigned to you",
  "link": "/projects/ABC/issues/ABC-123",
  "createdAt": "2026-06-25T10:15:30Z",
  "readAt": "2026-06-25T10:25:30Z",
  "sourceEventId": "7f7fa6c4-29f8-43f4-9471-7755e035f557"
}
```

### `PATCH /api/v1/notifications/read-all`

Статус: `proposed`.

Удобная ручка для inbox UI. В текущем gRPC есть только отметка одного уведомления.

Response `200`:

```json
{
  "updatedCount": 12
}
```

## Минимальный набор для фронтенд-макета

Если делать макет по шагам, достаточно начать с таких ручек:

| Экран | Ручки |
| --- | --- |
| Login | `POST /auth/login`, `POST /auth/refresh`, `GET /users/me` |
| Accept invite | `POST /auth/invitations/accept` |
| Project list | `GET /projects`, `POST /projects` |
| Project shell | `GET /projects/{projectId}`, `GET /projects/{projectId}/membership` |
| Board | `GET /projects/{projectId}/workflow`, `GET /projects/{projectId}/issues`, позже `POST /issues/{issueId}/transitions` |
| Issue card | `GET /projects/{projectId}/issues/{issueId}`, `PATCH /projects/{projectId}/issues/{issueId}`, `PUT /projects/{projectId}/issues/{issueId}/assignee` |
| Project members | `GET /projects/{projectId}/members`, `POST /projects/{projectId}/members`, `PATCH /projects/{projectId}/members/{userId}`, `DELETE /projects/{projectId}/members/{userId}` |
| Notifications | `GET /notifications`, `PATCH /notifications/{notificationId}/read` |

## Явные gaps перед реализацией REST

1. Нужен gRPC/REST метод поиска пользователей: для assignee picker, member picker, `users/me`.
2. Нужен gRPC/REST метод списка участников проекта.
3. Нужен метод transition issue, иначе kanban-доска может только отображать статусы, но не менять их.
4. Нужно решить default workflow binding для новых проектов.
5. Нужно определить глобальные роли для admin invite user.
6. Нужно решить, будет ли gateway отдавать чистые сервисные endpoints или BFF-агрегаты вроде `/board`.
7. Нужно закрепить JSON error schema в API Gateway, чтобы фронт одинаково обрабатывал ошибки всех сервисов.
