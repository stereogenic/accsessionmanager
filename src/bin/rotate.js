const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

const SERVER_CONFIG_PATH = path.join(BASE_DIR, './paths.json');
const ROTATION_CONFIG_PATH = path.join(BASE_DIR, './config.json');


let accServerProcess = null;
let isRotating = false;
let currentMode = 'stopped'; // 'rotation' | 'normal' | 'stopped'

function getConfig() {
  let serverConfig = {};
  let rotationConfig = {};

  if (fs.existsSync(SERVER_CONFIG_PATH)) {
    serverConfig = readJsonFileSync(SERVER_CONFIG_PATH);
  }
  if (fs.existsSync(ROTATION_CONFIG_PATH)) {
    rotationConfig = readJsonFileSync(ROTATION_CONFIG_PATH);
  }

  return { ...serverConfig, ...rotationConfig };
}

function getCfgPath(config) {
  if (config.cfgPath) return config.cfgPath;
  return path.join(BASE_DIR, 'cfg');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJsonFileSync(filePath) {
  const buffer = fs.readFileSync(filePath);
  let encoding = 'utf8';

  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    encoding = 'utf16le';
  } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    encoding = 'utf16be';
  } else if (buffer.length >= 2 && buffer[1] === 0x00) {
    encoding = 'utf16le';
  } else if (buffer.length >= 2 && buffer[0] === 0x00) {
    encoding = 'utf16be';
  }

  let text = buffer.toString(encoding);

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\0/g, '');
  text = text
    .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (m, g1) => g1 || '')
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\r\n]*/g, (m, g1) => g1 || '');
  text = text.replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(text);
}

function startAccServer(config) {
  const rawExePath = config.serverExePath || '../server/accServer.exe';
  const exePath = path.isAbsolute(rawExePath) 
    ? rawExePath 
    : path.resolve(BASE_DIR, rawExePath);

  const workingDir = path.dirname(exePath);

  console.log(`[Status] Launching accServer.exe directly from: ${exePath}`);
  
  accServerProcess = spawn(exePath, [], {
    cwd: workingDir,
    stdio: 'inherit'
  });

  accServerProcess.on('close', (code) => {
    console.log(`[accServer] Process exited with code ${code}`);
    accServerProcess = null;
    currentMode = 'stopped';
  });

  accServerProcess.on('error', (err) => {
    console.error(`[accServer ERROR]: Failed to start process: ${err.message}`);
    accServerProcess = null;
    currentMode = 'stopped';
  });
}

function stopAccServer() {
  return new Promise((resolve) => {
    if (!accServerProcess) {
      exec('taskkill /F /IM accServer.exe', () => resolve());
      return;
    }

    console.log('[Status] Terminating accServer process...');
    
    accServerProcess.once('close', () => resolve());
    accServerProcess.kill();

    setTimeout(() => {
      exec('taskkill /F /IM accServer.exe', () => resolve());
    }, 3000);
  });
}

function isInstanceRunning() {
  return accServerProcess !== null;
}

function updateEntryListWithBanlist(cfgDir) {
  const banlistPath = path.join(BASE_DIR, '../server/global-banlist.json');
  const entrylistFilePath = path.join(cfgDir, 'entrylist.json');

  if (!fs.existsSync(banlistPath)) {
    return;
  }

  try {
    const banData = readJsonFileSync(banlistPath);

    let entryListData = { entries: [], forceEntryList: 0 };
    if (fs.existsSync(entrylistFilePath)) {
      try {
        entryListData = readJsonFileSync(entrylistFilePath);
        if (!Array.isArray(entryListData.entries)) {
          entryListData.entries = [];
        }
      } catch (e) {
        entryListData = { entries: [], forceEntryList: 0 };
      }
    }

    const bannedEntries = (banData.enabled && Array.isArray(banData.entries)) ? banData.entries : [];
    const banMap = new Map();
    bannedEntries.forEach(b => banMap.set(String(b.playerId), b.playerName));

    // 1. Remove drivers from entrylist if they are no longer in global-banlist
    const initialCount = entryListData.entries.length;
    entryListData.entries = entryListData.entries.filter(entry => {
      if (!Array.isArray(entry.drivers)) return true;
      // If forcedCarModel === 9999, treat it as a managed ban entry
      if (entry.forcedCarModel === 9999) {
        const hasActiveBan = entry.drivers.some(driver => banMap.has(String(driver.playerID)));
        return hasActiveBan;
      }
      return true;
    });

    // Collect existing driver IDs to avoid adding duplicates
    const existingPlayerIds = new Set();
    entryListData.entries.forEach(entry => {
      if (Array.isArray(entry.drivers)) {
        entry.drivers.forEach(d => {
          if (d.playerID) existingPlayerIds.add(String(d.playerID));
        });
      }
    });

    // 2. Add missing banned drivers that aren't already present
    let addedCount = 0;
    bannedEntries.forEach(player => {
      const pidStr = String(player.playerId);
      if (!existingPlayerIds.has(pidStr)) {
        entryListData.entries.push({
          drivers: [
            {
              firstName: player.playerName,
              playerID: pidStr
            }
          ],
          forcedCarModel: 9999,
          overrideDriverInfo: 0,
          overrideCarModelForCustomCar: 0
        });
        existingPlayerIds.add(pidStr);
        addedCount++;
      }
    });

    fs.writeFileSync(entrylistFilePath, JSON.stringify(entryListData, null, 2), 'utf16le');
    console.log(`[Banlist] Updated entrylist.json: added ${addedCount} missing driver(s), pruned non-banned entries.`);
  } catch (err) {
    console.error(`[Banlist ERROR] Failed to process global-banlist.json: ${err.message}`);
  }
}

function updateTrackOnDisk(config, trackSettings) {
  const cfgDir = getCfgPath(config);
  
  // 1. EVENT.JSON
  const eventFilePath = path.join(cfgDir, 'event.json');
  if (!fs.existsSync(eventFilePath)) throw new Error(`Could not find event.json at path: ${eventFilePath}`);
  const eventConfig = readJsonFileSync(eventFilePath);
  
  if (trackSettings.track) eventConfig.track = String(trackSettings.track).toLowerCase();
  if (trackSettings.sessions) eventConfig.sessions = trackSettings.sessions;

  const eventOptionalKeys = ['preRaceWaitingTimeSeconds', 'sessionOverTimeSeconds', 'ambientTemp', 'cloudLevel', 'rain', 'weatherRandomness'];
  for (const key of eventOptionalKeys) {
    if (trackSettings[key] !== undefined) eventConfig[key] = trackSettings[key];
  }
  fs.writeFileSync(eventFilePath, JSON.stringify(eventConfig, null, 2), 'utf16le');

  // 2. SETTINGS.JSON
  const settingsFilePath = path.join(cfgDir, 'settings.json');
  if (fs.existsSync(settingsFilePath)) {
    const settingsConfig = readJsonFileSync(settingsFilePath);
    
    if (config.serverName !== undefined && config.serverName !== '') {settingsConfig.serverName = config.serverName;}
    if (config.adminPassword !== undefined && config.adminPassword !== '') {settingsConfig.adminPassword = config.adminPassword;}
    //if (config.password !== undefined && config.password !== '') {settingsConfig.password = config.password;} 
    if (config.password !== undefined) {settingsConfig.password = config.password;} 
    if (config.spectatorPassword !== undefined && config.spectatorPassword !== '') {settingsConfig.spectatorPassword = config.spectatorPassword;}  
    if (config.trackMedalsRequirement !== undefined && config.trackMedalsRequirement !== '') {settingsConfig.trackMedalsRequirement = config.trackMedalsRequirement;} 
    if (config.safetyRatingRequirement !== undefined && config.safetyRatingRequirement !== '') {settingsConfig.safetyRatingRequirement = config.safetyRatingRequirement;} 
    if (config.racecraftRatingRequirement !== undefined && config.racecraftRatingRequirement !== '') {settingsConfig.racecraftRatingRequirement = config.racecraftRatingRequirement;}
    if (config.maxCarSlots !== undefined && config.maxCarSlots !== '') {settingsConfig.maxCarSlots = config.maxCarSlots;}
    if (config.isRaceLocked !== undefined && config.isRaceLocked !== '') {settingsConfig.isRaceLocked = config.isRaceLocked;}
    if (config.shortFormationLap !== undefined && config.shortFormationLap !== '') {settingsConfig.shortFormationLap = config.shortFormationLap;}
    if (config.dumpLeaderboards !== undefined && config.dumpLeaderboards !== '') {settingsConfig.dumpLeaderboards = config.dumpLeaderboards;}
    if (config.dumpEntryList !== undefined && config.dumpEntryList !== '') {settingsConfig.dumpEntryList = config.dumpEntryList;}
    if (config.randomizeTrackWhenEmpty !== undefined && config.randomizeTrackWhenEmpty !== '') {settingsConfig.randomizeTrackWhenEmpty = config.randomizeTrackWhenEmpty;}
    if (config.allowAutoDQ !== undefined && config.allowAutoDQ !== '') {settingsConfig.allowAutoDQ = config.allowAutoDQ;}
    if (config.ignorePrematureDisconnects !== undefined && config.ignorePrematureDisconnects !== '') {settingsConfig.ignorePrematureDisconnects = config.ignorePrematureDisconnects;}
    if (config.formationLapType !== undefined && config.formationLapType !== '') {settingsConfig.formationLapType = config.formationLapType;}

    const settingsKeys = ['carGroup'];
    for (const key of settingsKeys) {
      if (trackSettings[key] !== undefined) settingsConfig[key] = trackSettings[key];
    }
    fs.writeFileSync(settingsFilePath, JSON.stringify(settingsConfig, null, 2), 'utf16le');
  }

  // 3. CONFIGURATION.JSON
  const configurationFilePath = path.join(cfgDir, 'configuration.json');
  if (fs.existsSync(configurationFilePath)) {
    const confConfig = readJsonFileSync(configurationFilePath);
    
    if (config.udpPort !== undefined && config.udpPort !== '') {confConfig.udpPort = config.udpPort;}
    if (config.tcpPort !== undefined && config.tcpPort !== '') {confConfig.tcpPort = config.tcpPort;}
    if (config.maxConnections !== undefined && config.maxConnections !== '') {confConfig.maxConnections = config.maxConnections;} 
    if (config.lanDiscovery !== undefined && config.lanDiscovery !== '') {confConfig.lanDiscovery = config.lanDiscovery;}  
    if (config.registerToLobby !== undefined && config.registerToLobby !== '') {confConfig.registerToLobby = config.registerToLobby;} 

    fs.writeFileSync(configurationFilePath, JSON.stringify(confConfig, null, 2), 'utf16le');
  }

  // 4. EVENTRULES.JSON
  const eventRulesFilePath = path.join(cfgDir, 'eventRules.json');
  if (fs.existsSync(eventRulesFilePath)) {
    const eventRulesConfig = readJsonFileSync(eventRulesFilePath);
    const eventRulesKeys = [
      'mandatoryPitstopCount', 'isRefuellingAllowedInRace', 'isRefuellingTimeFixed', 
      'isMandatoryPitstopRefuellingRequired', 'isMandatoryPitstopTyreChangeRequired', 'isMandatoryPitstopSwapDriverRequired'
    ];
    for (const key of eventRulesKeys) {
      if (trackSettings[key] !== undefined) eventRulesConfig[key] = trackSettings[key];
    }
    fs.writeFileSync(eventRulesFilePath, JSON.stringify(eventRulesConfig, null, 2), 'utf8');
  }

  // 5. ENTRYLIST.JSON (Global Banlist Integration)
  updateEntryListWithBanlist(cfgDir);

  return eventConfig;
}

async function waitForSessionCompletion(config, trackSettings, trackStartTime) {
  const cfgDir = getCfgPath(config);
  const resultsDir = path.join(path.dirname(cfgDir), 'results');

  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const existingFiles = new Set(fs.readdirSync(resultsDir));
  const sessions = trackSettings.sessions || [];
  
  if (sessions.length === 0) {
    await sleep(60 * 60 * 1000);
    return 'NEXT';
  }

  const targetType = sessions[sessions.length - 1].sessionType; 
  let targetSuffix = `_${targetType}.json`;
  if (targetType === 'P') targetSuffix = '_FP.json';

  await sleep(10000);

  while (isRotating) {
    if (fs.existsSync(resultsDir)) {
      const currentFiles = fs.readdirSync(resultsDir);
      for (const file of currentFiles) {
        if (!existingFiles.has(file)) {
          const filePath = path.join(resultsDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < trackStartTime) {
              existingFiles.add(file);
              continue;
            }
          } catch (e) {}

          if (file.endsWith(targetSuffix) || (targetType === 'P' && file.endsWith('_P.json'))) {
            console.log(`\n[Status] Final session result generated (${file}). Moving to next track...`);
            await sleep(5000);
            return 'NEXT'; 
          } else {
            existingFiles.add(file);
          }
        }
      }
    }

    if (!isInstanceRunning()) {
      if (fs.existsSync(resultsDir)) {
        const finalFiles = fs.readdirSync(resultsDir);
        for (const file of finalFiles) {
          if (!existingFiles.has(file)) {
            const filePath = path.join(resultsDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (stat.mtimeMs >= trackStartTime && (file.endsWith(targetSuffix) || (targetType === 'P' && file.endsWith('_P.json')))) {
                console.log(`\n[Status] Final session result generated (${file}). Moving to next track...`);
                await sleep(5000);
                return 'NEXT';
              }
            } catch (e) {}
          }
        }
      }

      console.log('\n[Status] accServer process stopped unexpectedly. Halting rotation loop.');
      return 'STOPPED';
    }

    await sleep(5000);
  }
  return 'STOPPED';
}

async function startNormal(trackIndex = 0) {
  isRotating = false;
  currentMode = 'stopped';

  console.log('[Status] Ensuring old instances are stopped...');
  await stopAccServer();
  await sleep(2000);

  const currentConfig = getConfig();
  if (!currentConfig.rotation || currentConfig.rotation.length === 0) {
    console.log('[Status] No tracks configured.');
    return;
  }

  const trackSettings = currentConfig.rotation[trackIndex] || currentConfig.rotation[0];

  console.log(`\n-------------------------------------------------`);
  console.log(`[${new Date().toLocaleTimeString()}] Starting NORMAL MODE - Track: ${String(trackSettings.track).toUpperCase()}`);
  console.log(`-------------------------------------------------`);

  updateTrackOnDisk(currentConfig, trackSettings);
  await sleep(1000);

  startAccServer(currentConfig);
  currentMode = 'normal';
}

async function startRotation() {
  if (isRotating) return;
  isRotating = true;
  currentMode = 'rotation';
  console.log('[Status] Ensuring old instances are stopped...');
  await stopAccServer();
  await sleep(2000);

  while (isRotating) {
    const config = getConfig();
    if (!config.rotation || config.rotation.length === 0) {
      console.log('[Status] No tracks configured in rotation.');
      break;
    }

    for (let i = 0; i < config.rotation.length; i++) {
      if (!isRotating) break;
      const currentConfig = getConfig();
      const trackSettings = currentConfig.rotation[i];

      console.log(`\n-------------------------------------------------`);
      console.log(`[${new Date().toLocaleTimeString()}] Loading track: ${String(trackSettings.track).toUpperCase()}`);
      console.log(`-------------------------------------------------`);

      await stopAccServer();
      console.log('[Status] Waiting for network ports to release...');
      await sleep(5000);

      updateTrackOnDisk(currentConfig, trackSettings);
      await sleep(1000);

      const trackStartTime = Date.now();
      startAccServer(currentConfig);

      const action = await waitForSessionCompletion(currentConfig, trackSettings, trackStartTime);
      if (action === 'STOPPED' || !isRotating) {
        isRotating = false;
        currentMode = 'stopped';
        return;
      }
    }
  }
  isRotating = false;
  currentMode = 'stopped';
}

async function stopRotation() {
  isRotating = false;
  currentMode = 'stopped';
  await stopAccServer();
}

function isRunning() {
  return isRotating || isInstanceRunning();
}

function getStatus() {
  const running = isRunning();
  return {
    running,
    mode: isRotating ? 'rotation' : (running ? 'normal' : 'stopped')
  };
}

module.exports = { startRotation, startNormal, stopRotation, isRunning, getStatus };