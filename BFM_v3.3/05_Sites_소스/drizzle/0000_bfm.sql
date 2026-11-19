CREATE TABLE records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('node', 'polygon')),
  origin_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  UNIQUE (kind, origin_id)
);
--> statement-breakpoint
CREATE INDEX records_recent ON records (kind, updated_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE activity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  change TEXT
);
--> statement-breakpoint
INSERT INTO activity (id) VALUES (1);
--> statement-breakpoint
CREATE TABLE import_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  result TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE provider_requests (
  provider TEXT PRIMARY KEY,
  last_requested INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER records_created AFTER INSERT ON records BEGIN
  UPDATE activity SET revision = revision + 1,
    change = json_object('action', NEW.kind || '-created', 'id', NEW.id,
      'name', json_extract(NEW.payload, '$.name'), 'at', NEW.updated_at)
  WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER records_updated AFTER UPDATE ON records BEGIN
  UPDATE activity SET revision = revision + 1,
    change = json_object('action', NEW.kind || '-updated', 'id', NEW.id,
      'name', json_extract(NEW.payload, '$.name'), 'at', NEW.updated_at)
  WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER records_deleted AFTER DELETE ON records BEGIN
  UPDATE activity SET revision = revision + 1,
    change = json_object('action', OLD.kind || '-deleted', 'id', OLD.id,
      'name', json_extract(OLD.payload, '$.name'), 'at', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  WHERE id = 1;
END;
