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

function norm(s) {
  return (s || "").toString().trim().replace(/['׳״]/g, "");
}

const now = DateTime.now().setZone(ZONE);

const runAt = DateTime.fromISO(now.toISODate() + "T07:00", { zone: ZONE });
if (now < runAt) {
  console.log("Too early");
  process.exit(0);
}

const todayISO = now.toISODate();

const hebDayByLuxon = {
  7: "ראשון",
  1: "שני",
  2: "שלישי",
  3: "רביעי",
  4: "חמישי",
  5: "שישי",
  6: "שבת"
};

const dayOffsetFromSunday = {
  ראשון: 0,
  שני: 1,
  שלישי: 2,
  רביעי: 3,
  חמישי: 4,
  שישי: 5,
  שבת: 6
};

const todayHebDay = hebDayByLuxon[now.weekday];
const isSunday = true;

const daysSinceSunday = now.weekday === 7 ? 0 : now.weekday;
const weekStart = now.startOf("day").minus({ days: daysSinceSunday });
const weekEnd = weekStart.plus({ days: 6 });

const weekStartISO = weekStart.toISODate();
const weekEndISO = weekEnd.toISODate();

console.log("Today:", todayISO, todayHebDay);
console.log("Week:", weekStartISO, "to", weekEndISO);

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

function getPageTitle(page) {
  const titleProp = Object.values(page.properties).find(p => p.type === "title");
  return titleProp?.title?.[0]?.plain_text || "NO NAME";
}

async function createLogIfMissing(templatePage, dateISO, existing) {
  const key = `${templatePage.id}|${dateISO}`;
  const name = getPageTitle(templatePage);

  if (existing.has(key)) {
    console.log("Skipped duplicate:", name, dateISO);
    return;
  }

  await notion.pages.create({
    parent: { database_id: LOG_DB_ID },
    properties: {
      [PROP_HABIT]: { relation: [{ id: templatePage.id }] },
      [PROP_DATE]: { date: { start: dateISO } },
      [PROP_COMPLETED]: { checkbox: false }
    }
  });

  existing.add(key);
  console.log("Created:", name, dateISO);
}

// Existing logs for this week
const logsThisWeek = await queryAll(LOG_DB_ID, {
  and: [
    {
      property: PROP_DATE,
      date: { on_or_after: weekStartISO }
    },
    {
      property: PROP_DATE,
      date: { on_or_before: weekEndISO }
    }
  ]
});

const existing = new Set();

for (const logPage of logsThisWeek) {
  const rel = logPage.properties?.[PROP_HABIT];
  const date = logPage.properties?.[PROP_DATE]?.date?.start;

  if (rel?.type === "relation" && date) {
    for (const r of rel.relation || []) {
      existing.add(`${r.id}|${date}`);
    }
  }
}

// Active templates
const templates = await queryAll(TEMPLATES_DB_ID, {
  property: PROP_ACTIVE,
  checkbox: { equals: true }
});

for (const t of templates) {
  const name = getPageTitle(t);
  const freq = t.properties?.[PROP_FREQ]?.select?.name;

  console.log("Checking:", name);
  console.log("Frequency:", freq);

  if (freq === "יומי") {
    await createLogIfMissing(t, todayISO, existing);
    continue;
  }

  if (freq === "שבועי") {
    if (!isSunday) {
      console.log("Skipped weekly because today is not Sunday:", name);
      continue;
    }

    const days = t.properties?.[PROP_DAYS]?.multi_select || [];
    console.log("Weekly days:", days.map(d => d.name));

    for (const d of days) {
      const dayName = norm(d.name);
      const offset = dayOffsetFromSunday[dayName];

      if (offset === undefined) {
        console.log("Unknown day:", d.name, "for", name);
        continue;
      }

      const targetDate = weekStart.plus({ days: offset }).toISODate();
      await createLogIfMissing(t, targetDate, existing);
    }

    continue;
  }

  console.log("Skipped unknown frequency:", name, freq);
}

console.log("Done");
