-- Búsqueda por texto en notas y enlaces (R18). Índice FTS5 externo sobre `notes`,
-- sin acentos para que "despliegue" encuentre "Despliegue" y "información" a "informacion".
CREATE VIRTUAL TABLE `notes_fts` USING fts5(
  title, body_md, url,
  content='notes', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `notes_fts_ai` AFTER INSERT ON `notes` BEGIN
  INSERT INTO notes_fts(rowid, title, body_md, url) VALUES (new.id, new.title, new.body_md, coalesce(new.url, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `notes_fts_ad` AFTER DELETE ON `notes` BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body_md, url) VALUES ('delete', old.id, old.title, old.body_md, coalesce(old.url, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `notes_fts_au` AFTER UPDATE ON `notes` BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body_md, url) VALUES ('delete', old.id, old.title, old.body_md, coalesce(old.url, ''));
  INSERT INTO notes_fts(rowid, title, body_md, url) VALUES (new.id, new.title, new.body_md, coalesce(new.url, ''));
END;
