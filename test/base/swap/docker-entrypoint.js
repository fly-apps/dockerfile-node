#!/usr/bin/env node

const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')

const env = {...process.env}

;(async() => {
  // allocate swap space
  await exec('fallocate -l 512M /swapfile')
  await exec('chmod 0600 /swapfile')
  await exec('mkswap /swapfile')
  writeFileSync('/proc/sys/vm/swappiness', '10')
  await exec('swapon /swapfile')
  writeFileSync('/proc/sys/vm/overcommit_memory', '1')

  // launch application
  await exec(process.argv.slice(2).join(' '))
})()

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
