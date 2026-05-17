import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "repository"

PLANS = {
    "system/system_status.db": [
        """
        CREATE TABLE IF NOT EXISTS service_status (
            service_name TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS system_alerts (
            id INTEGER PRIMARY KEY,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        DELETE FROM service_status;
        DELETE FROM system_alerts;
        INSERT INTO service_status(service_name, status, updated_at) VALUES
            ('ingest', 'OK', '20260517 101500'),
            ('sync', 'WARN', '20260517 102000'),
            ('backup', 'OK', '20260517 102300');
        INSERT INTO system_alerts(id, severity, message, created_at) VALUES
            (1, 'INFO', 'nightly backup completed', '20260517 010500'),
            (2, 'WARN', 'sync lag detected', '20260517 094000');
        """,
    ],
    "system/system_reference.db": [
        """
        CREATE TABLE IF NOT EXISTS code_map (
            code TEXT PRIMARY KEY,
            code_group TEXT NOT NULL,
            meaning TEXT NOT NULL
        );
        DELETE FROM code_map;
        INSERT INTO code_map(code, code_group, meaning) VALUES
            ('GOLD', 'customer_level', 'high-value customer'),
            ('SILVER', 'customer_level', 'mid-value customer'),
            ('VIP26', 'campaign_code', 'VIP campaign 2026');
        """,
    ],
    "current/current_sales.db": [
        """
        CREATE TABLE IF NOT EXISTS customers_current (
            customer_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            city TEXT NOT NULL,
            level_code TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS orders_current (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            ordered_at TEXT NOT NULL
        );
        DELETE FROM customers_current;
        DELETE FROM orders_current;
        INSERT INTO customers_current(customer_id, name, city, level_code) VALUES
            (1, 'Kim Minsoo', 'Seoul', 'GOLD'),
            (2, 'Lee Ara', 'Busan', 'SILVER'),
            (3, 'Park Jihun', 'Incheon', 'GOLD');
        INSERT INTO orders_current(order_id, customer_id, amount, ordered_at) VALUES
            (5001, 1, 125000.0, '20260516 093000'),
            (5002, 2, 82000.0, '20260516 141500'),
            (5003, 1, 54000.0, '20260517 101000'),
            (5004, 3, 230000.0, '20260517 111500');
        """,
    ],
    "current/current_campaign.db": [
        """
        CREATE TABLE IF NOT EXISTS campaign_current (
            campaign_code TEXT PRIMARY KEY,
            campaign_name TEXT NOT NULL,
            discount_rate REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS campaign_target (
            campaign_code TEXT NOT NULL,
            customer_id INTEGER NOT NULL,
            PRIMARY KEY (campaign_code, customer_id)
        );
        DELETE FROM campaign_current;
        DELETE FROM campaign_target;
        INSERT INTO campaign_current(campaign_code, campaign_name, discount_rate) VALUES
            ('SPRING26', 'Spring Promotion 2026', 0.10),
            ('VIP26', 'VIP Premium 2026', 0.20);
        INSERT INTO campaign_target(campaign_code, customer_id) VALUES
            ('SPRING26', 1),
            ('SPRING26', 2),
            ('VIP26', 3);
        """,
    ],
    "hist/hist_sales_2025.db": [
        """
        CREATE TABLE IF NOT EXISTS orders_hist (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            ordered_at TEXT NOT NULL
        );
        DELETE FROM orders_hist;
        INSERT INTO orders_hist(order_id, customer_id, amount, ordered_at) VALUES
            (4101, 1, 78000.0, '20250110 100500'),
            (4102, 2, 63000.0, '20250312 154000'),
            (4103, 3, 190000.0, '20251120 113000');
        """,
    ],
    "hist/hist_campaign_2025.db": [
        """
        CREATE TABLE IF NOT EXISTS campaign_result_hist (
            campaign_code TEXT NOT NULL,
            customer_id INTEGER NOT NULL,
            redeemed_amount REAL NOT NULL,
            redeemed_at TEXT NOT NULL
        );
        DELETE FROM campaign_result_hist;
        INSERT INTO campaign_result_hist(campaign_code, customer_id, redeemed_amount, redeemed_at) VALUES
            ('SPRING25', 1, 12000.0, '20250401 120000'),
            ('SPRING25', 2, 9000.0, '20250402 150000'),
            ('VIP25', 3, 25000.0, '20251030 101000');
        """,
    ],
}


def main() -> None:
    created = []
    for rel_path, scripts in PLANS.items():
        db_path = ROOT / rel_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(db_path)
        try:
            cur = conn.cursor()
            for sql_script in scripts:
                cur.executescript(sql_script)
            conn.commit()
            created.append(db_path)
        finally:
            conn.close()

    print(f"created_count={len(created)}")
    for path in created:
        print(path.as_posix())


if __name__ == "__main__":
    main()
