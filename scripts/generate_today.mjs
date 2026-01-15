import { Client } from "@notionhq/client";
import { DateTime } from "luxon";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const TEMPLATES_DB_ID = process.env.TEMPLATES_DB_ID;
const LOG_DB_ID = process.env.LOG_DB_ID;

const PROP_ACTIVE = "Active";
const PROP_FREQ = "d/w";
const PROP_DAYS = "ימים";

const PROP_HABIT = "Habit";
const PROP_DATE = "תאריך";
const PROP_COMPLETED = "צ'ק";

const ZONE = "Asia/Jerusalem";
const RUN_TIME = "07:30";

function norm(s) {
  return (s || "").toString().trim().replace(/['׳״]/g, "");
}

const now = DateTime.now().setZone(ZONE);
if (now.toFormat("HH:mm") !== RUN_TIME) {
  console.log("Not time yet");
  process.exit(0);
}

const todayISO = now.toISODate();

// Luxon weekday: 1=Mon ... 7=Sun
const hebDayByLuxon = {
  7: "ראשון",
  1: "שני",
  2: "שלישי",
  3: "רביעי",
  4: "חמישי",
  5: "שישי",
  6: "שבת"
};

const todayHebDay = hebDayByLuxon[now.weekday];
if (!todayHebDay) {
  console.log("Could not map weekday");
  process.exit(1);
}

async function queryAll(db, filter) {
  let results = [];
  let cursor;
  do {
    const r = await notion.databases.query({
      database_id: db,
      filter,
      start_cursor: cursor
    });
    results.push(...r.results);
    cursor = r.next_cursor;
  } while (cursor);
  return results;
}

// existing logs today (duplicate protection)
const logsToday = await queryAll(LOG_DB_ID, {
  property: PROP_DATE,
  date: { equals: todayISO }
});

const existing = new Set();
for (const l of logsToday) {
  const rel = l.properties?.[PROP_HABIT];
  if (rel?.type === "relation") {
    for (const r of rel.relation || []) existing.add(r.id);
  }
}

// active templates
const templates = await queryAll(TEMPLATES_DB_ID, {
  property: PROP_ACTIVE,
  checkbox: { equals: true }
});

for (const t of templates) {
  if (existing.has(t.id)) continue;

  const freq = t.properties?.[PROP_FREQ]?.select?.name;

  if (freq === "יומי") {
    // due today
  } else if (freq === "שבועי") {
    const days = (t.properties?.[PROP_DAYS]?.multi_select || []).map(x => norm(x.name));
    if (!days.includes(norm(todayHebDay))) continue;
  } else {
    continue;
  }

  await notion.pages.create({
    parent: { database_id: LOG_DB_ID },
    properties: {
      [PROP_HABIT]: { relation: [{ id: t.id }] },
      [PROP_DATE]: { date: { start: todayISO } },
      [PROP_COMPLETED]: { checkbox: false }
    }
  });
}

console.log("Done");
