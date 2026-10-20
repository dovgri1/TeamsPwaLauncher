const { execFileSync } = require('child_process')
const path = require('path')

/**
 * Linux-packaged .app files have no Mach-O signature, so Apple silicon reports them
 * as "damaged". Ad-hoc sign on a real Mac so users can Control-click → Open.
 */
exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin' || context.electronPlatformName !== 'darwin') {
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })
  console.log(`ad-hoc signed ${appPath}`)
}
