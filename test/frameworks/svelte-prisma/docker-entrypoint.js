#!/usr/bin/env node

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const env = { ...process.env }

// If running the web server then migrate existing database
if (process.argv.slice(-2).join(' ') === 'node ./build/index.js') {
  // place Sqlite3 database on volume
  const source = path.resolve('./dev.db')
  const target = '/data/' + path.basename(source)
  if (!fs.existsSync(source) && fs.existsSync('/data')) fs.symlinkSync(target, source)
  const newDb = !fs.existsSync(target)

  // prepare database
  await exec('npx prisma migrate deploy')
  if (newDb) await exec("tsx prisma/seed.ts")
}

// launch application
await exec(process.argv.slice(2).join(' '))

function exec(command) {
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} failed rc=${code}`))
      }
    })
  })
}
