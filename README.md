# Car OBD — тестовый companion (Android)

Минимальное Expo/React Native приложение для проверки связки **телефон ↔ ELM327-совместимый OBD-II адаптер**. Это не веб-гараж MVP, а тонкий companion (фаза 2 продукта Car): сканирование → VIN (если ЭБУ отдаёт) → несколько PID → сырой/разобранный ответ → отключение. Синхронизация в облако — **заглушка** (`src/sync/readingsSync.ts`).

Рабочее имя продукта: **Car**. Код лежит отдельно от Residence More / RM OS.

## Что умеет

1. Выбор транспорта: **Bluetooth Classic (SPP, основной)** / **BLE** / **симулятор**.
2. Сканирование и подключение к адаптеру (Classic также показывает уже спаренные устройства).
3. Инициализация ELM327 (`ATZ`, `ATE0`, …).
4. Чтение VIN (`0902`), DTC Mode 03 (только чтение), опрос поддерживаемых PID (`0100`/`0120`/`0140`/`0160`).
5. Чтение всех Mode 01 PID из каталога, которые ЭБУ заявил и которые мы умеем разобрать (обороты, скорость, ОЖ, дроссель, IAT, MAF, топливо, O₂, нагрузка, timing, …) + `ATRV` (бортсеть).
6. Неподдерживаемые команды пропускаются без падения сессии.
7. Показ DTC, списка параметров (с опциональным сырым ответом) и полного сырого лога.
8. Постановка снимка в локальную очередь sync (без реального API).

> **Expo Go** — только симулятор. Живой BT: `npx expo prebuild --platform android` и `npx expo run:android` (Dev Client). Подробно: `docs/live-obd-phone-guide.md` в Context проекта Car.

## Classic vs BLE — что реально работает

| Транспорт | Типичные дешёвые ELM327 | Expo Go | Dev Client / `expo run:android` |
| --- | --- | --- | --- |
| **Bluetooth Classic SPP** | **Да, большинство** с AliExpress / «ELM327» | Нет (нет native SPP) | Да (`react-native-bluetooth-classic`) |
| **BLE GATT** | Только если на коробке явно BLE / приложение производителя пишет BLE | Нет | Да (`react-native-ble-plx`), UUID сервисов часто FFF0/FFE0 или Nordic UART |
| **Симулятор** | — | **Да** | Да |

**Практический вывод:** ориентируйтесь на **Classic SPP**. Многие продавцы пишут «Bluetooth 4.0», но адаптер всё равно Classic. BLE-путь в приложении есть, но UUID и notify/write у клонов разные — может понадобиться подстройка под конкретную модель.

На Android 12+ нужны разрешения `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` (и часто геолокация для сканирования). Адаптер лучше один раз спарить в системных настройках Bluetooth.

## Запуск на реальном Android

### A. Быстрый UI без железа (симулятор)

Нужны Node 20+ и телефон с **Expo Go** *или* эмулятор:

```bash
cd /workspace/car-obd-app   # или ваш путь к клону
npm install
npx expo start
```

На телефоне: Expo Go → сканировать QR **или** `a` для эмулятора. В приложении выберите **«Симулятор»** → «Сканировать» → любое устройство → увидите VIN/PID.

> Classic и BLE **не работают в Expo Go** — только симулятор.

### B. Реальный адаптер (рекомендуется Dev Client)

На машине с Android SDK / к телефону по USB (отладка по USB):

```bash
cd /workspace/car-obd-app
npm install
npx expo prebuild --platform android
npx expo run:android
```

Либо EAS Build (нужен аккаунт Expo у Егора, **без** вшивания секретов в репозиторий):

```bash
npx eas-cli build --platform android --profile development
```

Дальше: зажигание ON → адаптер в разъёме OBD-II → в приложении **Bluetooth Classic** (или BLE, если адаптер BLE) → сканировать → подключить.

### Требования к машине

- Разъём OBD-II, зажигание включено (часто нужен RUNNING для части PID).
- ЭБУ отвечает на Mode 01; Mode 09 (VIN) — **не на всех** авто.

## Структура кода

```
car-obd-app/
  App.tsx                 # экраны теста (RU)
  src/obd/
    types.ts              # общие типы
    protocol.ts           # ELM/PID parse
    session.ts            # init → VIN → PIDs
    classicTransport.ts   # SPP
    bleTransport.ts       # GATT
    mockTransport.ts      # симулятор
  src/sync/readingsSync.ts # stub очереди в API
```

Позже: `ReadingsSyncClient.enqueue` → `POST` на Car API (`obd_readings`), привязка `car_id`.

## Что OBD может и чего не может

**Может (типично):**

- Живые PID: обороты, скорость, температуры, нагрузка, дроссель, топливо, O₂ (где просто), timing, MAF…
- DTC (коды ошибок) — Mode 03, только чтение (без очистки).
- Пробег через OBD — **нестандартно**: на части авто есть PID/расширения, часто нет → в MVP гаража пробег ручной.
- VIN — Mode 09 PID 02, если ЭБУ отдаёт.

**Не может / не стоит ждать:**

- Заменить сервисную диагностику дилера.
- Гарантировать одинаковые PID на всех марках (есть proprietary).
- Надёжный фон 24/7 без отдельной работы над Foreground Service.
- **Расшифровку VIN** (марка, модель, комплектация, история) — это **внешние VIN decode API** / базы, не шина OBD. OBD максимум отдаёт 17 символов; каталог и «чистота» авто — другой сервис.

## Безопасность

- В репозиторий **не** класть PAT, токены, пароли, ключи API.
- Sync-заглушка не ходит в сеть.
- Для будущего API — переменные окружения / EAS Secrets, не `README` с примерами реальных ключей.

## Git / GitHub

Проект задуман как **отдельный** репозиторий (не ветка Residence More):

```bash
cd /workspace/car-obd-app
git init
git add .
git commit -m "Initial Car OBD companion test app"
# Создайте пустой repo на GitHub, затем:
# git remote add origin git@github.com:<org-or-user>/car-obd-app.git
# git push -u origin main
```

Не пушить в `preview`/`main` Residence More. Force push не использовать.

## Ограничения текущего спайка

- UUID BLE перебираются эвристикой — конкретная модель может потребовать whitelist.
- Multi-frame VIN у части адаптеров может прийти иначе; парсер best-effort.
- Нет фонового сервиса и авто-реконнекта.
- Дизайн намеренно минимальный (functional first).
