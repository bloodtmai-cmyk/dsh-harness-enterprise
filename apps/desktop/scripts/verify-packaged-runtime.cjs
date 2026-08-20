const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const PRODUCT = 'Harness Enterprise Desktop'
const REQUIRED_RUNTIME_PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-client-web',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/cordis-plugin-loader',
  '@wecom/cli',
  'node-pty',
]

function assertFile(path, label) {
  if (!existsSync(path)) throw new Error(`packaged runtime missing ${label}: ${path}`)
}

function packageDirectory(name, from) {
  let cursor = from
  while (true) {
    const candidate = join(cursor, 'node_modules', ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}

function verifyDependencyClosure(appRoot) {
  const rootPackage = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  const queue = Object.keys(rootPackage.dependencies || {}).map(name => ({ name, from: appRoot }))
  const visited = new Set()
  const foundNames = new Set()
  const notices = []
  while (queue.length > 0) {
    const current = queue.shift()
    const directory = packageDirectory(current.name, current.from)
      || packageDirectory(current.name, appRoot)
    if (directory === undefined) throw new Error(`packaged dependency is missing: ${current.name}`)
    const manifestPath = join(directory, 'package.json')
    const key = resolve(manifestPath)
    if (visited.has(key)) continue
    visited.add(key)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    foundNames.add(manifest.name || current.name)
    const license = typeof manifest.license === 'string' ? manifest.license.trim() : ''
    if (license.length === 0) throw new Error(`packaged dependency has no license declaration: ${current.name}`)
    notices.push(`${manifest.name || current.name}@${manifest.version || 'unknown'} - ${license}`)
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      queue.push({ name: dependency, from: directory })
    }
  }
  for (const name of REQUIRED_RUNTIME_PACKAGES) {
    if (!foundNames.has(name)) throw new Error(`required runtime package is missing: ${name}`)
  }
  return notices.sort((left, right) => left.localeCompare(right, 'en'))
}

function executablePath(context) {
  if (context.electronPlatformName === 'darwin') {
    return join(context.appOutDir, `${PRODUCT}.app`, 'Contents', 'MacOS', PRODUCT)
  }
  if (context.electronPlatformName === 'win32') return join(context.appOutDir, `${PRODUCT}.exe`)
  return undefined
}

function verifyWeComCli(root, context, notices) {
  const packageName = context.electronPlatformName === 'win32'
    ? '@wecom/cli-win32-x64'
    : process.arch === 'x64' ? '@wecom/cli-darwin-x64' : '@wecom/cli-darwin-arm64'
  const cliDirectory = packageDirectory('@wecom/cli', root)
  if (cliDirectory === undefined) throw new Error('packaged WeCom CLI wrapper is missing')
  const directory = packageDirectory(packageName, cliDirectory) || packageDirectory(packageName, root)
  if (directory === undefined) throw new Error(`packaged WeCom CLI is missing: ${packageName}`)
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const binary = context.electronPlatformName === 'win32' ? 'wecom-cli.exe' : 'wecom-cli'
  assertFile(join(directory, 'bin', binary), 'official WeCom CLI')
  notices.push(`${manifest.name || packageName}@${manifest.version || 'unknown'} - ${manifest.license || 'UNKNOWN'}`)
}

function appRoot(context) {
  if (context.electronPlatformName === 'darwin') {
    return join(context.appOutDir, `${PRODUCT}.app`, 'Contents', 'Resources', 'app')
  }
  return join(context.appOutDir, 'resources', 'app')
}

async function runSmoke(executable) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, ['--desktop-runtime-smoke'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_DESKTOP_RUNTIME_SMOKE: '1' },
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(new Error('packaged runtime smoke timed out'))
    }, 30_000)
    const consume = chunk => { output = `${output}${chunk.toString('utf8')}`.slice(-16_384) }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0 || !output.includes('DSH_DESKTOP_RUNTIME_OK')) {
        rejectPromise(new Error(`packaged runtime smoke failed (${String(code)}): ${output}`))
      } else resolvePromise()
    })
  })
}

module.exports = async function verifyPackagedRuntime(context) {
  const root = appRoot(context)
  const desktopPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (desktopPackage.version !== context.packager.appInfo.version) {
    throw new Error(`packaged version mismatch: ${desktopPackage.version} != ${context.packager.appInfo.version}`)
  }
  assertFile(join(root, 'lib', 'main.js'), 'desktop host')
  assertFile(join(root, 'renderer', 'main-preload.cjs'), 'renderer preload')
  const resources = dirname(root)
  assertFile(join(resources, 'config', 'desktop.patch.yml'), 'managed desktop patch')
  const notices = verifyDependencyClosure(root)
  verifyWeComCli(root, context, notices)
  notices.sort((left, right) => left.localeCompare(right, 'en'))
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(resources, 'THIRD-PARTY-NOTICES.txt'), [
    'DSH Enterprise Intelligent Workspace - Third-Party Notices',
    '',
    ...notices,
    '',
  ].join('\n'))
  const executable = executablePath(context)
  if (executable !== undefined) assertFile(executable, 'application executable')
  if (executable !== undefined
    && ((context.electronPlatformName === 'darwin' && process.platform === 'darwin')
      || (context.electronPlatformName === 'win32' && process.platform === 'win32'))) {
    await runSmoke(executable)
  }
}
