# User Seeding Scripts

Two equivalent ways to seed the demo user accounts.
Both set every password to **`Admin@123`** and use **Main Store** as the pinned store.

## Users created

| Username      | Role         | Global | Store      |
|---------------|--------------|--------|------------|
| admin         | super_admin  | ✅ Yes  | all stores |
| store_admin   | admin        | ❌ No   | Main Store |
| manager1      | manager      | ❌ No   | Main Store |
| cashier1      | cashier      | ❌ No   | Main Store |
| cashier2      | cashier      | ❌ No   | Main Store |
| stockkeeper1  | stock_keeper | ❌ No   | Main Store |

---

## Option A — SQL script (recommended, no app needed)

Runs directly against PostgreSQL. Safe to run multiple times (`ON CONFLICT … DO UPDATE`).

```bash
psql -U quantum_user -d pos_app -f scripts/seed_users.sql
```

If your credentials differ:
```bash
psql "postgres://quantum_user:quantum_password@localhost:5432/pos_app" \
     -f scripts/seed_users.sql
```

---

## Option B — Node.js API script (app must be running)

Calls the live HTTP API exactly like the UI does.
Requires the app to be running (`npm run tauri dev` or the built binary).

```bash
# Default: connects to localhost:4000, logs in as admin/Admin@123
node scripts/seed_users.js

# Custom port / credentials
node scripts/seed_users.js --port 4000 --admin admin --password Admin@123

# Set a different password for the seeded users
node scripts/seed_users.js --seed-pw "MyPass@456"
```

Requires Node.js 18+ (uses `util.parseArgs` and native `http`).

---

## Adding more users later

Use the **Users** page in the app (Settings → Users) once logged in as `admin` or `store_admin`.
