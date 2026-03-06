const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const VERSION = require("../package.json").version;
const REPO = "shellshare/cli";

const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
const archMap = { x64: "amd64", arm64: "arm64" };

const platform = platformMap[os.platform()];
const arch = archMap[os.arch()];

if (!platform || !arch) {
  console.error(`Unsupported platform: ${os.platform()}-${os.arch()}`);
  process.exit(1);
}

const ext = os.platform() === "win32" ? ".exe" : "";
const binaryName = `shellshare-${platform}-${arch}${ext}`;
const binDir = path.join(__dirname, "..", "bin");
const binaryPath = path.join(binDir, binaryName);

// Skip if binary already exists
if (fs.existsSync(binaryPath)) {
  console.log(`shellshare binary already exists at ${binaryPath}`);
  process.exit(0);
}

const archiveExt = os.platform() === "win32" ? "zip" : "tar.gz";
const archiveName = `shellshare_${VERSION}_${platform}_${arch}.${archiveExt}`;
const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${archiveName}`;

console.log(`Downloading shellshare v${VERSION} for ${platform}/${arch}...`);
console.log(`URL: ${url}`);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          download(response.headers.location, dest)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(
            new Error(`Download failed with status ${response.statusCode}`)
          );
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shellshare-"));
  const archivePath = path.join(tmpDir, archiveName);

  try {
    await download(url, archivePath);

    fs.mkdirSync(binDir, { recursive: true });

    if (archiveExt === "tar.gz") {
      execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`);
    } else {
      execSync(`unzip -o "${archivePath}" -d "${tmpDir}"`);
    }

    const extractedBinary = path.join(tmpDir, `shellshare${ext}`);
    fs.copyFileSync(extractedBinary, binaryPath);
    fs.chmodSync(binaryPath, 0o755);

    console.log(`Successfully installed shellshare to ${binaryPath}`);
  } catch (err) {
    console.error(`Failed to install shellshare: ${err.message}`);
    console.error(
      "You can manually download the binary from: https://github.com/shellshare/cli/releases"
    );
    // Don't fail the npm install
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
