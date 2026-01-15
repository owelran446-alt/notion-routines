import { Client } from "@notionhq/client";
import { DateTime } from "luxon";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const TEMPLATES_DB_ID = process.env.TEMPLATES_DB_ID;
const LOG_DB_ID = process.env.LOG_DB_ID;

const PROP_ACTIVE = "Active";
const PROP_FREQ = "d/w";
const PROP_DAYS = "Days";
const PROP_HABIT = "Habit";
const PROP_DATE = "Date";
const PROP_COMPLETED = "Completed";

const ZONE = "Asia/Jerusalem";
const RUN_TIME = "07:30";

const now = DateTime.now().setZone(ZONE);
if (now.toFormat("HH:mm") !== RUN_TIME) {
  console.log("Not time yet");
  process.exit(0);
}

const todayISO = now.toISODate();
const weekday = now.toFormat("ccc"); // Mon Tue Wed

function norm(s) {
  return (s || "").toLowerCase().replace(/['׳״]/g, "");
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

const logsToday = await queryAll(LOG_DB_ID, {
  property: PROP_DATE,
  date: { equals: todayISO }
});

const existing = new Set();
for (const l of logsToday) {
  for (const r of l.properties[PROP_HABIT].relation) {
    existing.add(r.id);
  }
}

const templates = await queryAll(TEMPLATES_DB_ID, {
  property: PROP_ACTIVE,
  checkbox: { equals: true }
});

for (const t of templates) {
  if (existing.has(t.id)) continue;

  const freq = t.properties[PROP_FREQ].select?.name;
  if (freq === "Daily") {
    // ok
  } else if (freq === "Weekly") {
    const days = t.properties[PROP_DAYS].multi_select.map(d => norm(d.name));
    if (!days.includes(norm(weekday))) continue;
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
