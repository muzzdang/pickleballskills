---
aliases: ["Dashboard", "Pickleball Wiki Dashboard"]
last_updated: 2026-05-21
---

# Pickleball Wiki Dashboard

> Requires the [Obsidian Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview). Install it via Settings → Community Plugins → Dataview.

---

## All Sources

```dataview
TABLE
  channel AS "Channel",
  date AS "Date",
  duration AS "Duration",
  file.link AS "Title"
FROM "pickleball-wiki/wiki/sources"
WHERE type = "source"
SORT date DESC
```

---

## Universal Rackets Only

```dataview
TABLE
  date AS "Date",
  duration AS "Duration",
  file.link AS "Title"
FROM "pickleball-wiki/wiki/sources"
WHERE type = "source" AND channel = "Universal Rackets"
SORT date DESC
```

---

## All Concepts

```dataview
TABLE
  sources AS "# Sources",
  last_updated AS "Last Updated",
  file.link AS "Concept"
FROM "pickleball-wiki/wiki/concepts"
WHERE type = "concept"
SORT file.name ASC
```

---

## All Entities

```dataview
TABLE
  sources AS "# Sources",
  last_updated AS "Last Updated",
  file.link AS "Entity"
FROM "pickleball-wiki/wiki/entities"
WHERE type = "entity"
SORT file.name ASC
```

---

## Recently Updated (last 30 days)

```dataview
TABLE
  type AS "Type",
  last_updated AS "Updated",
  file.link AS "Page"
FROM "pickleball-wiki/wiki"
WHERE last_updated >= date(today) - dur(30 days)
SORT last_updated DESC
```

---

## Sources by Channel

```dataview
TABLE rows.file.link AS "Videos"
FROM "pickleball-wiki/wiki/sources"
WHERE type = "source" AND channel
GROUP BY channel
SORT rows.length DESC
```
