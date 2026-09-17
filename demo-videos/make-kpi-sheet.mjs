// A filled-in KPI template for the demo: a service engineer's job role rows,
// laid out exactly like the app's own "Download template" file.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { WORK_DIR } from './lib.mjs'

const require = createRequire('D:/Cyrix KPI/package.json')
const XLSX = require('xlsx')

const header = ['KRA& Weightage', 'KRA', 'KPI (Mesurable Parameter)', 'Weightage', 'Target KPI', 'Capping', 'If lower Capping']
const rows = [
  header,
  ['Job Role - 80%', 'Equipment Uptime', 'Average uptime of equipment at assigned hospitals (%)', 0.3, 95, 'Higher is better (max weightage)', ''],
  ['Job Role - 80%', 'Preventive Maintenance', 'Scheduled PMs completed on time (%)', 0.2, 100, 'Higher is better (max weightage)', ''],
  ['Job Role - 80%', 'Breakdown Response', 'Breakdown calls attended within 4 hours (%)', 0.2, 90, 'Higher is better (max weightage)', ''],
  ['Job Role - 80%', 'Repeat Breakdowns', 'Same equipment failing again within 30 days (count)', 0.1, 2, 'Lower is better (min 0 %)', ''],
]
const ws = XLSX.utils.aoa_to_sheet(rows)
ws['!cols'] = [{ wch: 20 }, { wch: 42 }, { wch: 60 }, { wch: 11 }, { wch: 11 }, { wch: 38 }, { wch: 16 }]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'KPI')
const file = path.join(WORK_DIR, 'My KPI - Kevin Test.xlsx')
fs.writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log(file)
