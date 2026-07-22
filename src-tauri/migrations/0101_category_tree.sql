-- ============================================================================
-- 0101: Category TREE — materialized path, cycle guard, subtree helper
-- ============================================================================
-- `categories.parent_category_id` has existed (self-FK, indexed) since 0024/0025
-- but was dormant: nothing set it and nothing read children. This migration
-- turns it into a real, safe tree.
--
-- DESIGN NOTES (deliberate deviations from the vet-webapp reference):
--   • ID-based path ('/3/7/') instead of a slug path. pos-app categories have
--     no slug column, and an id path means a RENAME never needs to cascade —
--     only a MOVE does. Fewer moving parts, no slug collision handling.
--   • UNIQUE (store_id, category_name) is deliberately KEPT. Relaxing it to
--     sibling-uniqueness would make Excel import's find-or-create-by-name
--     lookup ambiguous. Cost: no duplicate names across branches in one store.
--   • Parent must live in the SAME store. pos-app is multi-store; without this
--     you could parent a category under another store's category.
--   • A missing parent is TOLERATED (treated as root) rather than raising.
--     Cloud sync upserts rows in FK-tier order and a child can legitimately
--     arrive before its parent; raising here would hard-fail the sync row.
--     Genuine corruption (self-parent, cycles) still raises.
--
-- Departments are untouched — they remain the top-level grouping.
-- Idempotent and safe to re-run.
-- ============================================================================

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE categories ADD COLUMN IF NOT EXISTS path  TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS depth INT NOT NULL DEFAULT 0;

-- Prefix scans for subtree queries: WHERE path LIKE '/3/%'
CREATE INDEX IF NOT EXISTS idx_categories_path
    ON categories (path text_pattern_ops);

-- ── 2. Path/depth maintenance + integrity guards ─────────────────────────────
CREATE OR REPLACE FUNCTION categories_set_path()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    parent_path     TEXT;
    parent_depth    INT;
    parent_store    INT;
    max_depth CONSTANT INT := 5;   -- keep the tree browsable
BEGIN
    IF NEW.parent_category_id IS NULL THEN
        NEW.path  := '/' || NEW.id || '/';
        NEW.depth := 0;
        RETURN NEW;
    END IF;

    -- Self-parent is always corruption.
    IF NEW.parent_category_id = NEW.id THEN
        RAISE EXCEPTION 'A category cannot be its own parent (id %)', NEW.id;
    END IF;

    SELECT path, depth, store_id
      INTO parent_path, parent_depth, parent_store
      FROM categories
     WHERE id = NEW.parent_category_id;

    -- Parent not present yet (cloud-sync ordering): degrade to root instead of
    -- failing the write. A later update/re-sync recomputes it correctly.
    IF parent_path IS NULL THEN
        NEW.path  := '/' || NEW.id || '/';
        NEW.depth := 0;
        RETURN NEW;
    END IF;

    -- Cross-store nesting would leak categories between stores.
    IF parent_store IS DISTINCT FROM NEW.store_id THEN
        RAISE EXCEPTION 'Parent category % belongs to a different store', NEW.parent_category_id;
    END IF;

    -- Cycle guard: the new parent must not sit inside this node's own subtree.
    IF TG_OP = 'UPDATE' AND OLD.path IS NOT NULL AND parent_path LIKE OLD.path || '%' THEN
        RAISE EXCEPTION 'Cannot move category % under one of its own descendants', NEW.id;
    END IF;

    NEW.path  := parent_path || NEW.id || '/';
    NEW.depth := parent_depth + 1;

    IF NEW.depth > max_depth THEN
        RAISE EXCEPTION 'Category nesting too deep (max % levels)', max_depth;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_set_path ON categories;
CREATE TRIGGER trg_categories_set_path
    BEFORE INSERT OR UPDATE OF parent_category_id, store_id ON categories
    FOR EACH ROW EXECUTE FUNCTION categories_set_path();

-- ── 3. Cascade a move down the subtree ───────────────────────────────────────
-- Only fires when path actually changed (i.e. a MOVE). Renames don't touch
-- path at all, which is the whole point of the id-based scheme.
CREATE OR REPLACE FUNCTION categories_cascade_path()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.path IS DISTINCT FROM OLD.path AND OLD.path IS NOT NULL THEN
        UPDATE categories
           SET path  = NEW.path || SUBSTRING(path FROM LENGTH(OLD.path) + 1),
               depth = depth + (NEW.depth - OLD.depth)
         WHERE path LIKE OLD.path || '_%'
           AND id <> NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_cascade_path ON categories;
CREATE TRIGGER trg_categories_cascade_path
    AFTER UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION categories_cascade_path();

-- ── 4. Backfill existing rows ────────────────────────────────────────────────
-- Every existing row is effectively a root (parent_category_id was never set),
-- but the recursive CTE handles any pre-existing nesting correctly.
WITH RECURSIVE tree AS (
    SELECT id, parent_category_id, ('/' || id || '/')::text AS path, 0 AS depth
      FROM categories
     WHERE parent_category_id IS NULL
    UNION ALL
    SELECT c.id, c.parent_category_id, t.path || c.id || '/', t.depth + 1
      FROM categories c
      JOIN tree t ON c.parent_category_id = t.id
)
UPDATE categories c
   SET path = tree.path, depth = tree.depth
  FROM tree
 WHERE tree.id = c.id
   AND (c.path IS DISTINCT FROM tree.path OR c.depth IS DISTINCT FROM tree.depth);

-- Orphans (parent points at a missing row) — treat as roots so nothing is NULL.
UPDATE categories
   SET path = '/' || id || '/', depth = 0
 WHERE path IS NULL;

-- ── 5. Subtree helper ────────────────────────────────────────────────────────
-- Returns the node id + ALL descendant ids, so filtering by a parent category
-- can include everything nested under it. Nothing calls this yet — wiring it
-- into item/POS/analytics filters is a separate, opt-in decision.
CREATE OR REPLACE FUNCTION category_descendant_ids(p_root INT)
RETURNS INT[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(ARRAY_AGG(c.id), ARRAY[p_root])
      FROM categories c
     WHERE c.path LIKE (SELECT path FROM categories WHERE id = p_root) || '%';
$$;
