import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";

const require = createRequire(import.meta.url);

const root = new URL("../", import.meta.url);
const schemaDir = new URL("schemas/", root);
const outputDir = new URL("src/schema/generated/", root);
const files = (await readdir(schemaDir)).filter((name) => name.endsWith(".schema.json")).toSorted();
const ajv = new Ajv2020({ allErrors: true, strict: true, code: { esm: true, source: true } });
addFormats(ajv);
ajv.addKeyword({
  keyword: "uniqueTaskIds",
  meta: true,
});
const exports = {};
for (const file of files) {
  const schema = JSON.parse(await readFile(new URL(file, schemaDir), "utf8"));
  const name = path.basename(file, ".schema.json").replaceAll("-", "_");
  ajv.addSchema(schema);
  exports[name] = schema.$id;
}
await mkdir(outputDir, { recursive: true });
let code = standaloneCode(ajv, exports);
code = inlineRuntimeHelpers(code);
code = injectUniqueTaskIdsCheck(code);
await writeFile(new URL("validators.mjs", outputDir), code);

function inlineRuntimeHelpers(source) {
  const ucs2length = require("ajv/dist/runtime/ucs2length").default;
  const equal = require("ajv/dist/runtime/equal").default;

  return source
    .replace(/^"use strict";/, "")
    .replace(
      /const (\w+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/g,
      `const $1 = ${ucs2length.toString()};`,
    )
    .replace(
      /const (\w+) = require\("ajv\/dist\/runtime\/equal"\)\.default;/g,
      `const $1 = ${equal.toString()};`,
    )
    .replace(
      /const (\w+) = require\("ajv-formats\/dist\/formats"\)\.fullFormats\["date-time"\];/g,
      `${dateTimeFormatBundle()}\nconst $1 = { validate: date_time_validate, compare: compareDateTime };`,
    );
}

function dateTimeFormatBundle() {
  return `function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
const DATE = /^(\\d\\d\\d\\d)-(\\d\\d)-(\\d\\d)$/;
const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function date(str) {
  const matches = DATE.exec(str);
  if (!matches) return false;
  const year = +matches[1];
  const month = +matches[2];
  const day = +matches[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
}
function compareDate(d1, d2) {
  if (!(d1 && d2)) return undefined;
  if (d1 > d2) return 1;
  if (d1 < d2) return -1;
  return 0;
}
const TIME = /^(\\d\\d):(\\d\\d):(\\d\\d(?:\\.\\d+)?)(z|([+-])(\\d\\d)(?::?(\\d\\d))?)?$/i;
function getTime(strictTimeZone) {
  return function time(str) {
    const matches = TIME.exec(str);
    if (!matches) return false;
    const hr = +matches[1];
    const min = +matches[2];
    const sec = +matches[3];
    const tz = matches[4];
    const tzSign = matches[5] === "-" ? -1 : 1;
    const tzH = +(matches[6] || 0);
    const tzM = +(matches[7] || 0);
    if (tzH > 23 || tzM > 59 || (strictTimeZone && !tz)) return false;
    if (hr <= 23 && min <= 59 && sec < 60) return true;
    const utcMin = min - tzM * tzSign;
    const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
    return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
  };
}
function compareTime(s1, s2) {
  if (!(s1 && s2)) return undefined;
  const t1 = new Date("2020-01-01T" + s1).valueOf();
  const t2 = new Date("2020-01-01T" + s2).valueOf();
  if (!(t1 && t2)) return undefined;
  return t1 - t2;
}
const DATE_TIME_SEPARATOR = /t|\\s/i;
function getDateTime(strictTimeZone) {
  const time = getTime(strictTimeZone);
  return function date_time_validate(str) {
    const dateTime = str.split(DATE_TIME_SEPARATOR);
    return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
  };
}
function compareDateTime(dt1, dt2) {
  if (!(dt1 && dt2)) return undefined;
  const d1 = new Date(dt1).valueOf();
  const d2 = new Date(dt2).valueOf();
  if (!(d1 && d2)) return undefined;
  return d1 - d2;
}
const date_time_validate = getDateTime(true);`;
}

function injectUniqueTaskIdsCheck(source) {
  const helper = `function validateUniqueTaskIds(tasks) {
  const seen = new Set();
  for (const task of tasks) {
    if (task && typeof task === "object" && "id" in task) {
      if (seen.has(task.id)) {
        return false;
      }
      seen.add(task.id);
    }
  }
  return true;
}`;
  const match = source.match(/export const json_task_file_v1 = (validate\d+);/);
  if (!match) {
    throw new Error("injectUniqueTaskIdsCheck: json_task_file_v1 export not found in generated code");
  }
  return source.replace(
    match[0],
    `${helper}
const json_task_file_v1_base = ${match[1]};
export const json_task_file_v1 = function json_task_file_v1(data) {
  if (!json_task_file_v1_base(data)) {
    json_task_file_v1.errors = json_task_file_v1_base.errors;
    return false;
  }
  if (!validateUniqueTaskIds(data?.tasks ?? [])) {
    json_task_file_v1.errors = [{
      instancePath: "/tasks",
      schemaPath: "#/properties/tasks/uniqueTaskIds",
      keyword: "uniqueTaskIds",
      message: "must have unique task ids",
    }];
    return false;
  }
  return true;
};`,
  );
}
