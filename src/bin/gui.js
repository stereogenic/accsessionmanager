const http = require('http');
const fs = require('fs');
const path = require('path');
const { startRotation, startNormal, stopRotation, getStatus } = require('./rotate.js');

const PORT = 3030;
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const ROTATION_CONFIG_PATH = path.join(BASE_DIR, './config.json');
const BANLIST_PATH = path.join(BASE_DIR, '../server/global-banlist.json');
const RESULTS_DIR = path.join(BASE_DIR, '../server/results');

function getCfgPath() {
  let cfgPath = path.join(BASE_DIR, 'cfg');
  if (fs.existsSync(ROTATION_CONFIG_PATH)) {
    try {
      const conf = JSON.parse(fs.readFileSync(ROTATION_CONFIG_PATH, 'utf8'));
      if (conf.cfgPath) cfgPath = conf.cfgPath;
    } catch (e) {}
  }
  return cfgPath;
}

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
    encoding = 'utf08be';
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

// Synchronizes entrylist.json against global-banlist.json
function syncEntrylistWithBanlist() {
  const cfgDir = getCfgPath();
  const entryPath = path.join(cfgDir, 'entrylist.json');
  if (!fs.existsSync(entryPath)) return;

  try {
    let banlist = { enabled: true, entries: [] };
    if (fs.existsSync(BANLIST_PATH)) {
      banlist = JSON.parse(fs.readFileSync(BANLIST_PATH, 'utf8'));
    }

    const bannedEntries = (banlist.enabled && Array.isArray(banlist.entries)) ? banlist.entries : [];
    const banMap = new Map();
    bannedEntries.forEach(b => banMap.set(String(b.playerId), b.playerName));

    let entrylist = readJsonFileSync(entryPath);
    if (!Array.isArray(entrylist.entries)) {
      entrylist.entries = [];
    }

    // Filter out banned drivers that are no longer present in global-banlist
    entrylist.entries = entrylist.entries.filter(entry => {
      if (!Array.isArray(entry.drivers)) return true;
      if (entry.forcedCarModel === 9999) {
        return entry.drivers.some(driver => banMap.has(String(driver.playerID)));
      }
      return true;
    });

    const existingPlayerIds = new Set();
    entrylist.entries.forEach(entry => {
      if (Array.isArray(entry.drivers)) {
        entry.drivers.forEach(d => {
          if (d.playerID) existingPlayerIds.add(String(d.playerID));
        });
      }
    });

    // Append newly added banned drivers
    bannedEntries.forEach(player => {
      const pidStr = String(player.playerId);
      if (!existingPlayerIds.has(pidStr)) {
        entrylist.entries.push({
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
      }
    });

    fs.writeFileSync(entryPath, JSON.stringify(entrylist, null, 2), 'utf16le');
    console.log('[Banlist Sync] Successfully reconciled entrylist.json with global-banlist.json.');
  } catch (err) {
    console.error('Error synchronizing banlist with entrylist:', err);
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://127.0.0.1');
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>ACC Session Manager</title>
      <script src="/vue.js"></script>
      <style>
        :root { --bg: #121212; --card: #1e1e1e; --text: #e0e0e0; --accent: #e53935; --accent-hover: #ff5252; --border: #333; }
        
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px 15px; background: var(--bg); color: var(--text); font-size: 13px; display: flex; justify-content: center; }
        #app { width: 100%; max-width: 900px; }
        
        ::-webkit-scrollbar { width: 8px; height: 10px; }
        ::-webkit-scrollbar-track { background: #222; }
        ::-webkit-scrollbar-thumb { background: #555; border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: #e53935; }
        
        a {color:#e53935; text-decoration:none;}
        
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #e53935; padding-bottom: 0px; }
        h1 { margin: 0; font-size: 20px; font-weight: 500; }
        h2 { margin: 0 0 10px 0; font-size: 16px; color: #ccc; font-weight: 500; }
        h3 { margin: 0; font-weight: 500; }
        h4 { margin: 15px 0 10px 0; font-size: 11px; color: #fff; text-transform: uppercase; letter-spacing: 1px; font-weight: bold; border-bottom: 1px solid #2a2a2a; padding-bottom: 5px; }
        
        .subhead { margin: 15px 0 10px 0; font-size: 10px; color: #fff; text-transform: uppercase; letter-spacing: 1px; font-weight: bold; border-bottom: 1px solid #2a2a2a; padding-bottom: 5px; }
        
        hr { display: block; height: 1px; border: 0; border-top: 1px solid #e53935; margin: 1em 0; padding: 0; }
        hr.greyhr { display: block; height: 1px; border: 0; border-top: 1px solid #2a2a2a; margin: 10px 0px 10px 0px; padding: 0; }
        
        .script-controls { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          background: #222; 
          padding: 12px 15px; 
          border-radius: 6px; 
          border: 1px solid #444; 
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 15px;
        }
        
        .header-bar {
		    display: flex;
		    justify-content: space-between;
		    align-items: flex-start;
		    width: 100%;
				}

				.header-left {
				    display: flex;
				    align-items: flex-start;
				}

				.header-right {
				    display: flex;
				    justify-content: flex-end;
				    align-items: flex;
				}

        .controls-left { display: flex; flex-direction: column; gap: 6px; }
        .control-title { font-size: 13px; font-weight: bold; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; }
        .controls-right { display: flex; flex-direction: column; gap: 8px; align-items: flex-end;}
        .button-group { display: flex; gap: 8px; }
        
        .status-badge { font-weight: bold; font-size: 12px; padding: 6px 10px; border-radius: 3px; }
        .status-running { background: rgba(76, 175, 80, 0.2); color: #4caf50; border: 1px solid #4caf50; }
        .status-stopped { background: rgba(255, 82, 82, 0.2); color: #ff5252; border: 1px solid #ff5252; }

        .card { background: var(--card); padding: 10px 20px 10px 20px; border-radius: 6px; margin-bottom: 15px; border: 1px solid var(--border); box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .session-card { background: #252525; padding: 10px; border-radius: 4px; margin-top: 8px; border: 1px solid #333; }
        
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px 15px; }
        .grid-global { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px 15px; }
        
        .form-group { display: flex; flex-direction: column; }
        label { font-size: 11px; color: #aaa; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        input, select { background: #2c2c2c; border: 1px solid #444; color: white; padding: 4px 8px; border-radius: 3px; font-family: inherit; font-size: 13px; height: 32px; box-sizing: border-box; }
        input:focus, select:focus { border-color: var(--accent); outline: none; }
        
        .collapsible-header { cursor: pointer; user-select: none; display: flex; justify-content: space-between; transition: color 0.2s;}
        .collapsible-header:hover { color: var(--accent); border-bottom-color: var(--accent); }
        .collapsible-header span { font-size: 9px; color: #fff;}
        
        .red-header { cursor: pointer; user-select: none; display: flex; justify-content: space-between; transition: color 0.2s; color: #e0e0e0; border-bottom-color: var(--accent);}
        .red-header span { font-size: 9px; color: #fff;}
        .red-header:hover { color: var(--accent);}
        
        .checkbox-container { display: flex; align-items: center; gap: 8px; height: 30px; margin-top: 15px; }
        .checkbox-container input { width: 16px; height: 16px; cursor: pointer; margin: 0; accent-color: var(--accent); }
        .checkbox-container label { margin: 0; cursor: pointer; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #aaa; white-space: nowrap; }
        
        button { padding: 4px 8px; background: var(--accent); color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold; transition: background 0.2s; font-size: 13px; }
        button:hover { background: var(--accent-hover); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        
        button.small-btn { margin: 3px 0px; padding: 4px 6px; background: var(--accent); color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold; transition: background 0.2s; font-size: 10px; }
        button.small-btn:hover { background: var(--accent-hover); }
        .btn-small { padding: 6px 10px; font-size: 12px; background: #444; }
        .btn-small:hover { background: #555; }
        .btn-danger { background: transparent; color: #ff5252; border: 1px solid #ff5252; }
        .btn-danger:hover { background: #ff5252; color: white; }
        .btn-shutdown { background: #d32f2f; color: white; border: none; }
        .btn-shutdown:hover { background: #f44336; }
        .btn-success { background: #4caf50; color: white; border: none; }
        .btn-success:hover { background: #66bb6a; }
        .btn-blue { background: #2196f3; color: white; border: none; }
        .btn-blue:hover { background: #42a5f5; }
        .btn-blue:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .pagination-container { 
				  display: grid; 
				  grid-template-columns: 1fr auto 1fr; 
				  align-items: center; 
				  margin-top: 10px; 
				  padding-top: 8px; 
				  border-top: 1px solid #2a2a2a; 
					}
					.pagination-info { 
					  font-size: 11px; 
					  color: #aaa; 
					  text-align: left;
					}
					.pagination-controls { 
					  display: flex; 
					  gap: 6px; 
					  align-items: center; 
					  grid-column: 2;
					}

        .flex-between { display: flex; justify-content: space-between; align-items: center; }
        .track-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding-bottom: 12px; border-bottom: 1px solid #2a2a2a; }
        .actions-group { display: flex; gap: 6px; }
        .footer { text-align: center; font-size: 12px; color: #777; margin-top: 0px; border-top: 1px solid var(--accent); padding-top: 10px; }
      </style>
    </head>
    <body>
      <div id="app">
      	
      	<div class="header-bar">
		    <div class="header-left">
		       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 25 800 150" width="600" height="112.5">
          <rect y="25" width="800" height="150" fill="#121212" rx="12"/>
          <path d="M 57 140 A 63 63 0 1 1 162 140" fill="none" stroke="#2a2a2a" stroke-width="11" stroke-linecap="round"/>
          <path d="M 110 37 A 63 63 0 0 1 162 140" fill="none" stroke="#e53935" stroke-width="11" stroke-linecap="round"/>
          <rect x="78" y="84" width="63" height="17" rx="3" fill="#1e1e1e" stroke="#333333" stroke-width="2"/>
          <circle cx="90" cy="92" r="3" fill="#e53935"/>
          <circle cx="100" cy="92" r="3" fill="#555555"/>
          <line x1="115" y1="92" x2="131" y2="92" stroke="#555555" stroke-width="3" stroke-linecap="round"/>
          <rect x="78" y="106" width="63" height="17" rx="3" fill="#1e1e1e" stroke="#333333" stroke-width="2"/>
          <circle cx="90" cy="114" r="3" fill="#4caf50"/>
          <circle cx="100" cy="114" r="3" fill="#555555"/>
          <line x1="115" y1="114" x2="131" y2="114" stroke="#555555" stroke-width="3" stroke-linecap="round"/>
          <path d="M 110 52 L 110 78" fill="none" stroke="#ff5252" stroke-width="4" stroke-linecap="round"/>
          <polygon points="110,45 104,56 116,56" fill="#ff5252"/>
          <line x1="210" y1="40" x2="210" y2="160" stroke="#333333" stroke-width="2"/>
          <line x1="210" y1="70" x2="210" y2="130" stroke="#e53935" stroke-width="2"/>
          <text x="240" y="85" font-family="Segoe UI, Arial, sans-serif" font-weight="900" font-size="42" fill="#ffffff" letter-spacing="4">ACC</text>
          <text x="240" y="125" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="28" fill="#e53935" letter-spacing="2">SESSION MANAGER</text>
          <rect x="545" y="102" width="55" height="24" rx="4" fill="#2d1717" stroke="#e53935" stroke-width="1"/>
          <text x="553" y="118" font-family="Segoe UI, Arial, sans-serif" font-weight="bold" font-size="12" fill="#ff5252">v1.0</text>
          <text x="241" y="152" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#777777" letter-spacing="1">AUTOMATED SERVER ROTATION &amp; CONTROL</text>
        </svg>
		    </div>

		    <div class="header-right">
		        <button class="btn-small btn-shutdown" @click="shutdownApp">Shut Down<br>Session Manager</button>
		    </div>
			  </div>

        <div v-if="config">
          <div class="script-controls">
            <div class="controls-left">
              <div class="control-title">Server Control</div>
              <div class="button-group">
                <button class="btn-small btn-success" v-if="!serverStatus.running" @click="startMode('rotation')">▶ Start Rotation Mode</button>
                <button class="btn-small btn-blue" v-if="!serverStatus.running" :disabled="startButtonDisabled" 
                	@click="startButtonDisabled = true; startMode('normal', 0); setTimeout(() => startButtonDisabled = false, 3000)">▶ Start Normal Mode (Track 1)</button>
                <button class="btn-small btn-danger" v-if="serverStatus.running" @click="stopServer" style="background: rgba(255,82,82,0.1);">■ Stop Server</button>
              </div>
            </div>
            <div class="controls-right">
              <div class="status-badge" :class="serverStatus.running ? 'status-running' : 'status-stopped'">
                SERVER STATUS : {{ serverStatus.running ? ('RUNNING (' + serverStatus.mode.toUpperCase() + ')') : 'STOPPED' }}
              </div>
            </div>
          </div>

          <div class="card">
            <h4 class="red-header" @click="config._showGlobal = !config._showGlobal">Global Server Settings<span style="color:#e53935;">{{ config._showGlobal ? '▼' : '▶' }}</span></h4>
            <div v-show="config._showGlobal">
            	
              <span class="collapsible-header subhead" @click="config._showName = !config._showName">Server Name<span style="color:#e53935;">{{ config._showName ? '▼' : '▶' }}</span></span>
              <div v-show="config._showName">
              	
                <div class="grid-global">
                  <div class="form-group" style="grid-column: 1 / -1;">
                    <input v-model="config.serverName" type="text" placeholder="Server Name">
                  </div>
                </div>
                
                <hr class="greyhr">
              </div>

              <span class="collapsible-header subhead" @click="config._showNet = !config._showNet">Network Settings<span style="color:#e53935;">{{ config._showNet ? '▼' : '▶' }}</span></span>
              <div v-show="config._showNet">
                <div class="grid-global">
                  <div class="form-group"><label>Tcp Port</label><input v-model.number="config.tcpPort" type="number"></div>
                  <div class="form-group"><label>Udp Port</label><input v-model.number="config.udpPort" type="number"></div>
                  <div class="form-group"><label>Max Connections</label><input v-model.number="config.maxConnections" type="number"></div>
                </div>
                <div class="grid-global">
                  <div class="checkbox-container">
                    <input type="checkbox" id="registerToLobby" v-model="config.registerToLobby" :true-value="1" :false-value="0">
                    <label for="registerToLobby">Register To Lobby</label>
                  </div>
                  <div class="checkbox-container">
                    <input type="checkbox" id="lanDiscovery" v-model="config.lanDiscovery" :true-value="1" :false-value="0">
                    <label for="lanDiscovery">LAN Discovery</label>
                  </div>
                  <div class="checkbox-container">
                    <input type="checkbox" id="ignorePrematureDisconnects" v-model="config.ignorePrematureDisconnects" :true-value="1" :false-value="0">
                    <label for="ignorePrematureDisconnects">Ignore Disconnects</label>
                  </div>
                </div>
                <hr class="greyhr">
              </div>

              <span class="collapsible-header subhead" @click="config._showSettings = !config._showSettings">Server Passwords<span style="color:#e53935;">{{ config._showSettings ? '▼' : '▶' }}</span></span>
              <div v-show="config._showSettings">
                <div class="grid-global">
                  <div class="form-group"><label>Admin Password</label><input v-model="config.adminPassword" type="text" placeholder="Admin Password"></div>
                  <div class="form-group"><label>Spectator Password</label><input v-model="config.spectatorPassword" type="text" placeholder="Spectator Password"></div>
                  <div class="form-group"><label>Server Password</label><input v-model="config.password" type="text" placeholder="Server Password"></div>
                </div>
                <hr class="greyhr">
              </div>

              <span class="collapsible-header subhead" @click="config._showDriverSettings = !config._showDriverSettings">Driver Requirements<span style="color:#e53935;">{{ config._showDriverSettings ? '▼' : '▶' }}</span></span>
              <div v-show="config._showDriverSettings">
                <div class="grid-global">
                  <div class="form-group"><label>Safety Rating</label><input v-model.number="config.safetyRatingRequirement" type="number" min="-1" max="99"></div>
                  <div class="form-group">
                    <label>Track Medals</label>
                    <select v-model.number="config.trackMedalsRequirement" style="border-color: #555;">
                      <option :value="0">Disabled</option>
                      <option :value="0">0</option>
                      <option :value="1">1</option>
                      <option :value="2">2</option>
                      <option :value="3">3</option>
                    </select>
                  </div>
                  <div class="form-group"><label>Race Craft Req.</label><input v-model.number="config.racecraftRatingRequirement" type="number" min="-1" max="99"></div>
                </div>
                <hr class="greyhr">
              </div>

              <span class="collapsible-header subhead" @click="config._showsessRoles = !config._showsessRoles">Session Rules & Behavior<span style="color:#e53935;">{{ config._showsessRoles ? '▼' : '▶' }}</span></span>
              <div v-show="config._showsessRoles">
                <div class="grid-global">
                  <div class="form-group">
                    <label>Formation Type</label>
                    <select v-model.number="config.formationLapType" style="border-color: #555;">
                      <option :value="3">Position</option>
                      <option :value="1">Free</option>
                      <option :value="0">Manual</option>
                    </select>
                  </div>
                  <div class="form-group"><label>Max Car Slots</label><input v-model.number="config.maxCarSlots" type="number"></div>
                </div>
                <div class="grid-global">
                  <div class="checkbox-container">
                    <input type="checkbox" id="isRaceLocked" v-model="config.isRaceLocked" :true-value="1" :false-value="0">
                    <label for="isRaceLocked">Race Locked</label>
                  </div>
                  <div class="checkbox-container">
                    <input type="checkbox" id="allowAutoDQ" v-model="config.allowAutoDQ" :true-value="1" :false-value="0">
                    <label for="allowAutoDQ">Auto DSQ</label>
                  </div>
                  <div class="checkbox-container">
                    <input type="checkbox" id="shortFormationLap" v-model="config.shortFormationLap" :true-value="1" :false-value="0">
                    <label for="shortFormationLap">Short Formation</label>
                  </div>
                  <div class="checkbox-container">
                    <input type="checkbox" id="randomizeTrackWhenEmpty" v-model="config.randomizeTrackWhenEmpty" :true-value="1" :false-value="0">
                    <label for="randomizeTrackWhenEmpty">Randomise Empty</label>
                  </div>
                </div>
                <hr class="greyhr">
              </div>

              <span class="collapsible-header subhead" @click="config._dataLogging = !config._dataLogging">Data Logging & Outputs<span style="color:#e53935;">{{ config._dataLogging ? '▼' : '▶' }}</span></span>
              <div v-show="config._dataLogging">
                <div class="grid-global">
                  <div class="checkbox-container">
                    <input type="checkbox" id="dumpLeaderboards" v-model="config.dumpLeaderboards" :true-value="1" :false-value="0">
                    <label for="dumpLeaderboards">Dump Leaderboards</label>
                  </div>
                  <div class="checkbox-container">
                    <input type="checkbox" id="dumpEntryList" v-model="config.dumpEntryList" :true-value="1" :false-value="0">
                    <label for="dumpEntryList">Dump Entry List</label>
                  </div>
                </div>
                <hr class="greyhr">
              </div>
              <div style="width:100%; text-align:right;"><button @click="saveData()">Save Settings</button></div>
            </div>
          </div>
          
           <!-- GLOBAL BANLIST CARD -->
          <div class="card">
            <h4 class="red-header" @click="config._showBanlist = !config._showBanlist">
              Global Banlist Management <span style="color:#e53935;">{{ config._showBanlist ? '▼' : '▶' }}</span>
            </h4>
            <div v-show="config._showBanlist">
            	
              <div class="checkbox-container" style="margin-top: 5px; margin-bottom: 12px;">
                <input type="checkbox" id="banlistEnabled" v-model="banlist.enabled" @change="saveBanlist()">
                <label for="banlistEnabled">Enable Global Banlist Enforcement</label>
              </div>

              <div style="display: flex; gap: 10px; margin-bottom: 15px; align-items: flex-end;">
                <div class="form-group" style="flex: 1;">
                  <label>Player Name</label>
                  <input v-model="newPlayerName" type="text" placeholder="e.g. Driver Name">
                </div>
                <div class="form-group" style="flex: 1;">
                  <label>Steam ID (Player ID)</label>
                  <input v-model="newPlayerId" type="text" placeholder="e.g. S76561198000000000">
                </div>
                <button class="btn-success" style="height: 32px; padding: 0 15px;" @click="addBanEntry">+ Add Driver</button>
              </div>

              <div v-if="banlist.entries && banlist.entries.length > 0">
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                  <thead>
                    <tr style="border-bottom: 1px solid #444; text-align: left; color: #aaa; font-size: 11px; text-transform: uppercase;">
                      <th style="padding: 6px;">Player Name</th>
                      <th style="padding: 6px;">Steam ID</th>
                      <th style="padding: 6px; text-align: right;">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(entry, bIndex) in banlist.entries" :key="bIndex" style="border-bottom: 1px solid #2a2a2a;">
                      <td style="padding: 8px 6px; color: #fff;">{{ entry.playerName }}</td>
                      <td style="padding: 8px 6px; color: #aaa; font-family: monospace;">{{ entry.playerId }}</td>
                      <td style="padding: 8px 6px; text-align: right;">
                        <button class="btn-small btn-danger" @click="removeBanEntry(bIndex)">Remove</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              
              <div v-else style="color: #777; font-style: italic; padding: 10px 0;">
                No banned drivers currently in global banlist.
              </div>
              
              <br>
              	
              	
              <!-- SESSION RESULTS & BROWSER CARD -->
              <div class="flex-between" style="margin-bottom: 5px;">
                <h4 class="red-header" style="margin: 0; flex: 1;" @click="showLatestResults = !showLatestResults">
                  Browse Session Driver Results <span style="color:#e53935;">{{ showLatestResults ? '▼' : '▶' }}</span>
                </h4>
              </div>
            
              <div v-show="showLatestResults">
                <!-- RESULTS FILE SELECTOR -->
                <div style="display: flex; gap: 10px; align-items: center; margin-top: 8px; margin-bottom: 12px;" v-if="resultsFiles.length > 0">
                  <div class="form-group" style="flex: 1;">
                    <label>Latest 5 Result Files</label>
                    <select v-model="selectedFile" @change="fetchSessionResults" style="border-color: #555;">
                      <option v-for="file in resultsFiles" :key="file.name" :value="file.name">
                        {{ file.name }}
                      </option>
                    </select>
                  </div>
                  <button class="btn-small btn-blue" style="height: 32px; margin-top: 15px;" @click="fetchResultsFiles">Refresh List</button>
                </div>

                <div v-if="latestResults && latestResults.filename">
                  <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                    <div style="font-size: 11px; color: #aaa; word-break: break-all;">
                      <strong>File:</strong> {{ latestResults.filename }}<br>
                      <strong>Track / Session:</strong> {{ latestResults.trackName || 'Unknown Track' }} ({{ latestResults.sessionType || 'Session' }})
                    </div>
                  </div>

                  <div v-if="latestResults.drivers && latestResults.drivers.length > 0">
                    <table style="width: 100%; border-collapse: collapse; margin-top: 5px;">
                      <thead>
                        <tr style="border-bottom: 1px solid #444; text-align: left; color: #aaa; font-size: 11px; text-transform: uppercase;">
                          <th style="padding: 6px;">Driver Name</th>
                          <th style="padding: 6px;">Steam ID</th>
                          <th style="padding: 6px; text-align: right;">Quick Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(drv, dIndex) in paginatedDrivers" :key="dIndex" style="border-bottom: 1px solid #2a2a2a;">
                          <td style="padding: 8px 6px; color: #fff;">{{ drv.name }}</td>
                          <td style="padding: 8px 6px; color: #aaa; font-family: monospace;">{{ drv.playerId }}</td>
                          <td style="padding: 8px 6px; text-align: right;">
                            <button class="btn-small btn-danger" @click="quickBanDriver(drv)">+ Add to Banlist</button>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <!-- PAGINATION BAR -->
                    <div class="pagination-container" v-if="latestResults.drivers.length > itemsPerPage">
                      <div class="pagination-controls">
                        <button class="btn-small" :disabled="currentPage === 1" @click="currentPage--">◀ Prev</button>
                        <span style="font-size: 11px; color: #fff; padding: 0 4px;">Page {{ currentPage }} of {{ totalPages }}</span>
                        <button class="btn-small" :disabled="currentPage >= totalPages" @click="currentPage++">Next ▶</button>
                      </div>
                    </div>
                  </div>
                  <div v-else style="color: #777; font-style: italic; padding: 10px 0;">
                    No driver records found, Refresh at end of session.
                  </div>
                </div>
                <div v-else-if="latestResults && latestResults.message" style="color: #777; font-style: italic; padding: 10px 0;">
                  {{ latestResults.message }}
                </div>
                <div v-else style="color: #777; font-style: italic; padding: 10px 0;">
                  Loading session results...
                </div>
                <hr class="greyhr">
              </div>
          <!-- ---------- END DRIVER LIST --------- -->
              	
            </div> <!-- end visibility -->
          </div> <!-- end card --->

          <div class="card">
            <div class="flex-between" style="margin-top: 3px; margin-bottom: 1px;">
            <h2 style="margin: 0; font-size: 16px; color: #fff;">Track Rotation List &nbsp; <span style="font-size:12px; font-weight:normal; color:#e53935">Save Track Rotation before Starting The Server!</span></h2> 
              <button @click="saveData()">Save Rotation</button>
            </div>
          </div>

          <div v-for="(track, tIndex) in config.rotation" :key="tIndex" class="card">
            <div class="track-header">
              <div style="display: flex; gap: 10px; align-items: center;">
                <h3 style="color: #e53935; font-size: 16px;">{{ tIndex + 1 }}.</h3>
                <select v-model="track.track" style="width: 220px; border-color: #555;">
                  <option v-for="(humanName, gameId) in availableTracks" :key="gameId" :value="gameId">
                    {{ humanName }}
                  </option>
                </select>
                <div class="form-group">
                  <select v-model="track.carGroup" style="border-color: #555; width:133px;">
                    <option value="FreeForAll">Mixed</option>
                    <option value="GT3">GT3</option>
                    <option value="GT2">GT2</option>
                    <option value="GT4">GT4</option>
                    <option value="GTC">GTC</option>
                    <option value="TCX">TCX</option>
                  </select>
                </div>
              </div>

              <div class="actions-group">
                <button class="btn-small" @click="moveUp(tIndex)" v-if="tIndex > 0">↑ Up</button>
                <button class="btn-small" @click="moveDown(tIndex)" v-if="tIndex < config.rotation.length - 1">↓ Down</button>
                	<button class="btn-small btn-blue" v-if="!serverStatus.running" :disabled="startButtonDisabled" 
                	@click="startButtonDisabled = true; startMode('normal', tIndex); setTimeout(() => startButtonDisabled = false, 3000)">Run Single Track</button>
                <button class="btn-small btn-danger" @click="removeTrack(tIndex)">Delete</button>
              </div>
            </div>

            <h4 class="collapsible-header" @click="track._showPits = !track._showPits">
              Pitstop & Event Rules <span style="color:#e53935;">{{ track._showPits ? '▼' : '▶' }}</span>
            </h4>
            <div v-show="track._showPits">
              <div class="grid-global">
                <div class="form-group"><label>Mandatory Pits</label><input v-model.number="track.mandatoryPitstopCount" type="number"></div>
                <div class="checkbox-container">
                  <input type="checkbox" :id="'refuelOk-'+tIndex" v-model="track.isRefuellingAllowedInRace">
                  <label :for="'refuelOk-'+tIndex">Allow Refuelling</label>
                </div>
                <div class="checkbox-container">
                  <input type="checkbox" :id="'refuelFix-'+tIndex" v-model="track.isRefuellingTimeFixed">
                  <label :for="'refuelFix-'+tIndex">Fixed Refuel Time</label>
                </div>
              </div>
              <div class="grid-global">
                <div class="checkbox-container">
                  <input type="checkbox" :id="'reqRefuel-'+tIndex" v-model="track.isMandatoryPitstopRefuellingRequired">
                  <label :for="'reqRefuel-'+tIndex">Req. Refuelling</label>
                </div>
                <div class="checkbox-container">
                  <input type="checkbox" :id="'reqTyre-'+tIndex" v-model="track.isMandatoryPitstopTyreChangeRequired">
                  <label :for="'reqTyre-'+tIndex">Req. Tyre Change</label>
                </div>
                <div class="checkbox-container">
                  <input type="checkbox" :id="'reqSwap-'+tIndex" v-model="track.isMandatoryPitstopSwapDriverRequired">
                  <label :for="'reqSwap-'+tIndex">Req. Driver Swap</label>
                </div>
              </div>
              <hr class="greyhr">
            </div>

            <h4 class="collapsible-header" @click="track._showWeather = !track._showWeather">
              Weather Settings <span style="color:#e53935;">{{ track._showWeather ? '▼' : '▶' }}</span>
            </h4>
            <div v-show="track._showWeather">
              <div class="grid">
                <div class="form-group"><label>Temp (°C)</label><input v-model.number="track.ambientTemp" type="number"></div>
                <div class="form-group"><label>Cloud (0-1)</label><input v-model.number="track.cloudLevel" type="number" step="0.1"></div>
                <div class="form-group"><label>Rain (0-1)</label><input v-model.number="track.rain" type="number" step="0.1"></div>
                <div class="form-group"><label>Randomness</label><input v-model.number="track.weatherRandomness" type="number"></div>
                <div class="form-group">
                  <button class="small-btn" @click="setWeather(track, 16, 0.3, 0.0, 1)">Default</button>
                  <button class="small-btn" @click="setWeather(track, 23, 0.25, 0.0, 1)">Sunny Clear</button>
                  <button class="small-btn" @click="setWeather(track, 19, 0.55, 0.0, 1)">Overcast</button>
                </div>
                <div class="form-group">
                  <button class="small-btn" @click="setWeather(track, 20, 0.62, 0.12, 1)">Light Rain</button>
                  <button class="small-btn" @click="setWeather(track, 20, 0.70, 0.27, 1)">Medium Rain</button>
                  <button class="small-btn" @click="setWeather(track, 16, 0.88, 0.62, 2)">Heavy Rain</button>
                </div>
              </div>
              <hr class="greyhr">
            </div>

            <h4 class="collapsible-header" @click="track._showTimings = !track._showTimings">
              Server Timing <span style="color:#e53935;">{{ track._showTimings ? '▼' : '▶' }}</span>
            </h4>
            <div v-show="track._showTimings">
              <div class="grid-global">
                <div class="form-group"><label>Pre-Race (Sec)</label><input v-model.number="track.preRaceWaitingTimeSeconds" type="number"></div>
                <div class="form-group"><label>Overtime (Sec)</label><input v-model.number="track.sessionOverTimeSeconds" type="number"></div>
                <div class="form-group"><label>Post Qualy (Sec)</label><input v-model.number="track.postQualySeconds" type="number"></div>
                <div class="form-group"><label>Post Race (Sec)</label><input v-model.number="track.postRaceSeconds" type="number"></div>
              </div>
              <hr class="greyhr">
            </div>

            <h4 class="collapsible-header" @click="track._showSessions = !track._showSessions">
              Session Settings <span style="color:#e53935;">{{ track._showSessions ? '▼' : '▶' }}</span>
            </h4>
            <div v-show="track._showSessions" style="margin-top: 25px;">
              <div class="flex-between">
                <span></span>
                <button class="btn-small" @click="addSession(track)" style="background: #333;">+ Add Session</button>
              </div>

              <div v-for="(session, sIndex) in track.sessions" :key="sIndex" class="session-card">
                <div class="flex-between" style="margin-bottom: 8px;">
                  <strong style="color: #bbb; font-size: 12px;">Session {{ sIndex + 1 }}</strong>
                  <button class="btn-small btn-danger" style="padding: 2px 6px; font-size: 10px;" @click="track.sessions.splice(sIndex, 1)">Remove</button>
                </div>

                <div class="grid">
                  <div class="form-group">
                    <label>Type</label>
                    <select v-model="session.sessionType" style="border-color: #555;">
                      <option value="P">Practice (P)</option>
                      <option value="Q">Qualifying (Q)</option>
                      <option value="R">Race (R)</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Day</label>
                    <select v-model.number="session.dayOfWeekend" style="border-color: #555;">
                      <option :value="1">Friday (1)</option>
                      <option :value="2">Saturday (2)</option>
                      <option :value="3">Sunday (3)</option>
                    </select>
                  </div>
                  <div class="form-group"><label>Hour (0-23)</label><input v-model.number="session.hourOfDay" type="number" min="0" max="23"></div>
                  <div class="form-group"><label>Duration (Min)</label><input v-model.number="session.sessionDurationMinutes" type="number"></div>
                  <div class="form-group"><label>Time Multiplier</label><input v-model.number="session.timeMultiplier" type="number"></div>
                </div>
              </div>
            <div style="width:100%; text-align:right; margin-top:10px;"><button @click="saveData()">Save Rotation</button></div>
            </div>
          </div>

          <button @click="addTrack" style="width: 100%; padding: 12px; font-size: 14px; background: #1a1a1a; border: 1px dashed #555; color: #aaa; margin-bottom: 40px; cursor: pointer;">
            + Add New Track to Rotation
          </button>
          <div class="footer">ACC Session Manager &copy; 2026<br>Developed by Andrew Mcdonald aka NewbFixer<br><a href="https://www.accsessionmanager.co.uk/" target="_blank">www.accsessionmanager.co.uk</a></div>
        </div>
        <div v-else style="text-align: center; padding: 40px; color: #aaa;">
          Loading configuration...
        </div>
      </div>
   
      <script>
        const { createApp } = Vue;

        createApp({
          data() {
            return {
              config: null,
              banlist: { enabled: true, entries: [] },
              newPlayerName: '',
              newPlayerId: '',
              resultsFiles: [],
              selectedFile: '',
              latestResults: null,
              showLatestResults: false,
              serverStatus: { running: false, mode: 'stopped' },
              startButtonDisabled: false,
              currentPage: 1,
              itemsPerPage: 10,
              availableTracks: {
                'barcelona': 'Barcelona', 'brands_hatch': 'Brands Hatch', 'circuit_of_the_americas': 'COTA',
                'donington': 'Donington Park', 'hungaroring': 'Hungaroring', 'indianapolis': 'Indianapolis',
                'kyalami': 'Kyalami', 'laguna_seca': 'Laguna Seca', 'misano': 'Misano', 'monza': 'Monza Circuit',
                'mount_panorama': 'Bathurst', 'nurburgring': 'Nürburgring', 'nurburgring_24h': 'Nordschleife',
                'oulton_park': 'Oulton Park', 'paul_ricard': 'Paul Ricard', 'red_bull_ring': 'Red Bull Ring',
                'silverstone': 'Silverstone', 'snetterton': 'Snetterton', 'spa': 'Spa-Francorchamps',
                'suzuka': 'Suzuka', 'valencia': 'Valencia', 'watkins_glen': 'Watkins Glen',
                'zandvoort': 'Zandvoort', 'zolder': 'Zolder'
              }
            }
          },
          computed: {
            paginatedDrivers() {
              if (!this.latestResults || !Array.isArray(this.latestResults.drivers)) return [];
              const start = (this.currentPage - 1) * this.itemsPerPage;
              return this.latestResults.drivers.slice(start, start + this.itemsPerPage);
            },
            totalPages() {
              if (!this.latestResults || !Array.isArray(this.latestResults.drivers)) return 1;
              return Math.ceil(this.latestResults.drivers.length / this.itemsPerPage) || 1;
            }
          },
          mounted() {
            fetch('/api/config')
              .then(res => res.json())
              .then(data => { 
                if (data.serverName === undefined) data.serverName = "Server Name | Powered by ACC Session Manager | Track Rotation | Active Banlist";
                if (data.adminPassword === undefined) data.adminPassword = "admin";
                if (data.password === undefined) data.password = "";
                if (data.spectatorPassword === undefined) data.spectatorPassword = "spectator";
                if (data.trackMedalsRequirement === undefined) data.trackMedalsRequirement = 0;
                if (data.safetyRatingRequirement === undefined) data.safetyRatingRequirement = 60;
                if (data.racecraftRatingRequirement === undefined) data.racecraftRatingRequirement = -1;
                if (data.maxCarSlots === undefined) data.maxCarSlots = 30;
                if (data.isRaceLocked === undefined) data.isRaceLocked = 0;
                if (data.shortFormationLap === undefined) data.shortFormationLap = 1;
                if (data.dumpLeaderboards === undefined) data.dumpLeaderboards = 1;
                if (data.dumpEntryList === undefined) data.dumpEntryList = 0;
                if (data.randomizeTrackWhenEmpty === undefined) data.randomizeTrackWhenEmpty = 0;
                if (data.allowAutoDQ === undefined) data.allowAutoDQ = 1;
                if (data.ignorePrematureDisconnects === undefined) data.ignorePrematureDisconnects = 1;
                if (data.formationLapType === undefined) data.formationLapType = 3;
                if (data.udpPort === undefined) data.udpPort = 9231;
                if (data.tcpPort === undefined) data.tcpPort = 9232;
                if (data.maxConnections === undefined) data.maxConnections = 32;
                if (data.lanDiscovery === undefined) data.lanDiscovery = 0;
                if (data.registerToLobby === undefined) data.registerToLobby = 1;
                if (data._showBanlist === undefined) data._showBanlist = false;
                
                if (data.rotation) {
                  data.rotation.forEach(track => { 
                    if (!track.carGroup) track.carGroup = "FreeForAll"; 
                    track._showReqs = false;
                    track._showPits = false;
                    track._showWeather = false;
                    track._showSessions = false;
                    track._showTimings = false;
                  });
                }
                this.config = data; 
              })
              .catch(err => alert('Failed to load config: ' + err.message));

            fetch('/api/banlist')
              .then(res => res.json())
              .then(data => {
                if (!data.entries) data.entries = [];
                if (data.enabled === undefined) data.enabled = true;
                this.banlist = data;
              })
              .catch(err => console.error('Failed to load banlist: ' + err.message));

            this.fetchResultsFiles();
            this.checkScriptStatus();
            setInterval(this.checkScriptStatus, 3000);
          },
          methods: {
            checkScriptStatus() {
              fetch('/api/script/status')
                .then(res => res.json())
                .then(data => this.serverStatus = data)
                .catch(() => this.serverStatus = { running: false, mode: 'stopped' });
            },
            fetchResultsFiles() {
              fetch('/api/results-files')
                .then(res => res.json())
                .then(files => {
                  this.resultsFiles = files || [];
                  if (this.resultsFiles.length > 0 && !this.selectedFile) {
                    this.selectedFile = this.resultsFiles[0].name;
                  }
                  this.fetchSessionResults();
                })
                .catch(err => console.error('Failed to fetch results files:', err));
            },
            fetchSessionResults() {
              this.currentPage = 1;
              const fileParam = this.selectedFile ? ('?file=' + encodeURIComponent(this.selectedFile)) : '';
              fetch('/api/session-results' + fileParam)
                .then(res => res.json())
                .then(data => {
                  this.latestResults = data;
                  if (data && data.filename) {
                    this.selectedFile = data.filename;
                  }
                })
                .catch(err => {
                  this.latestResults = { message: 'Failed to fetch session results: ' + err.message };
                });
            },
            quickBanDriver(drv) {
              if (!drv || !drv.playerId) return;
              if (confirm('Are you sure you want to add "' + drv.name + '" (' + drv.playerId + ') to the Global Banlist?')) {
                if (!this.banlist.entries) this.banlist.entries = [];
                const exists = this.banlist.entries.some(e => String(e.playerId) === String(drv.playerId));
                if (exists) {
                  alert('Driver is already present in the global banlist.');
                  return;
                }
                this.banlist.entries.push({
                  playerName: drv.name,
                  playerId: String(drv.playerId)
                });
                this.saveBanlist();
                alert('Added ' + drv.name + ' to Global Banlist!');
              }
            },
            startMode(mode, trackIndex = 0) {
              const endpoint = mode === 'rotation' ? '/api/script/start' : '/api/script/start-normal';
              fetch(endpoint, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackIndex })
              })
                .then(res => {
                  if (res.ok) this.checkScriptStatus();
                  else alert('Failed to start server in ' + mode + ' mode.');
                })
                .catch(err => alert('Error: ' + err.message));
            },
            stopServer() {
              fetch('/api/script/stop', { method: 'POST' })
                .then(res => {
                  if (res.ok) this.checkScriptStatus();
                  else alert('Failed to stop server.');
                })
                .catch(err => alert('Error: ' + err.message));
                this.startButtonDisabled = false;
            },
            shutdownApp() {
              if (confirm('Are you sure you want to stop the server and close ACC Session Manager?')) {
                fetch('/api/app/shutdown', { method: 'POST' })
                  .then(() => {
                    alert('ACC Session Manager has been shut down.');
                    window.close();
                  })
                  .catch(err => alert('Error shutting down: ' + err.message));
              }
            },
            saveData() {
              const configToSave = JSON.parse(JSON.stringify(this.config));
              delete configToSave._showBanlist;
              if (configToSave.rotation) {
                configToSave.rotation.forEach(t => {
                  delete t._showReqs;
                  delete t._showPits;
                  delete t._showWeather;
                  delete t._showSessions;
                  delete t._showTimings;
                });
              }

              fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configToSave)
              })
              .then(res => {
                if(res.ok) alert('Settings saved!');
                else throw new Error('Save failed');
              })
              .catch(err => alert('Error saving: ' + err.message));
            },
            saveBanlist() {
              fetch('/api/banlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.banlist)
              })
              .catch(err => alert('Error saving banlist: ' + err.message));
            },
            addBanEntry() {
              if (!this.newPlayerName.trim() || !this.newPlayerId.trim()) {
                alert('Please enter both Player Name and Steam ID.');
                return;
              }
              if (!this.banlist.entries) this.banlist.entries = [];
              this.banlist.entries.push({
                playerName: this.newPlayerName.trim(),
                playerId: this.newPlayerId.trim()
              });
              this.newPlayerName = '';
              this.newPlayerId = '';
              this.saveBanlist();
            },
            removeBanEntry(index) {
              if (confirm('Remove driver from global banlist?')) {
                this.banlist.entries.splice(index, 1);
                this.saveBanlist();
              }
            },
            setWeather(track, ambtemp, cloud, rain, randomness) {
              track.ambientTemp = ambtemp;
              track.cloudLevel = cloud;
              track.rain = rain;
              track.weatherRandomness = randomness;
            },
            addTrack() {
              if(!this.config.rotation) this.config.rotation = [];
              this.config.rotation.push({
                track: "monza", 
                carGroup: "FreeForAll", 
                _showReqs: false,
                _showPits: false,
                _showWeather: false,
                _showSessions: false,
                _showTimings: false,
                mandatoryPitstopCount: 0,
                isRefuellingAllowedInRace: true,
                isRefuellingTimeFixed: false,
                isMandatoryPitstopRefuellingRequired: false,
                isMandatoryPitstopTyreChangeRequired: false,
                isMandatoryPitstopSwapDriverRequired: false,
                ambientTemp: 16, cloudLevel: 0.27, rain: 0.15, weatherRandomness: 1, 
                preRaceWaitingTimeSeconds: 80, sessionOverTimeSeconds: 150,
                postQualySeconds: 5, postRaceSeconds: 5,
                sessions: [
                  { hourOfDay: 14, dayOfWeekend: 2, timeMultiplier: 1, sessionType: "Q", sessionDurationMinutes: 12 },
                  { hourOfDay: 14, dayOfWeekend: 3, timeMultiplier: 1, sessionType: "R", sessionDurationMinutes: 20 }
                ]
              });
            },
            removeTrack(index) { if(confirm('Remove this track?')) this.config.rotation.splice(index, 1); },
            addSession(track) {
              if(!track.sessions) track.sessions = [];
              track.sessions.push({ hourOfDay: 14, dayOfWeekend: 3, timeMultiplier: 1, sessionType: "R", sessionDurationMinutes: 20 });
            },
            moveUp(index) { const item = this.config.rotation.splice(index, 1)[0]; this.config.rotation.splice(index - 1, 0, item); },
            moveDown(index) { const item = this.config.rotation.splice(index, 1)[0]; this.config.rotation.splice(index + 1, 0, item); }
          }
        }).mount('#app');
      </script>
    </body>
    </html>
    `);
  } 
  
  else if (req.method === 'GET' && pathname === '/vue.js') {
    let vuePath = path.join(BASE_DIR, 'vue.global.prod.js');
    if (!fs.existsSync(vuePath)) {
      vuePath = path.join(BASE_DIR, 'vue.js');
    }

    if (fs.existsSync(vuePath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(fs.readFileSync(vuePath));
    } else {
      res.writeHead(404);
      res.end('Vue file not found in bin folder');
    }
  }

  else if (req.method === 'GET' && pathname === '/api/config') {
    let rotationData = {};
    if (fs.existsSync(ROTATION_CONFIG_PATH)) {
      rotationData = JSON.parse(fs.readFileSync(ROTATION_CONFIG_PATH, 'utf8'));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rotationData));
  } 
  
  else if (req.method === 'POST' && pathname === '/api/config') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      let existingRotationConfig = {};

      try {
        if (fs.existsSync(ROTATION_CONFIG_PATH)) {
          existingRotationConfig = JSON.parse(fs.readFileSync(ROTATION_CONFIG_PATH, 'utf8'));
        }
      } catch (err) {
        console.error('Error reading configuration files:', err);
      }

      const rotationConfig = {
        ...existingRotationConfig,
        serverName: parsed.serverName !== undefined ? parsed.serverName : (existingRotationConfig.serverName || ''),
        password: parsed.password !== undefined ? parsed.password : (existingRotationConfig.password || ''),
        adminPassword: parsed.adminPassword !== undefined ? parsed.adminPassword : (existingRotationConfig.adminPassword || ''),
        spectatorPassword: parsed.spectatorPassword !== undefined ? parsed.spectatorPassword : (existingRotationConfig.spectatorPassword || ''),
        trackMedalsRequirement: parsed.trackMedalsRequirement !== undefined ? parsed.trackMedalsRequirement : (existingRotationConfig.trackMedalsRequirement || 0),
        safetyRatingRequirement: parsed.safetyRatingRequirement !== undefined ? parsed.safetyRatingRequirement : (existingRotationConfig.safetyRatingRequirement || 0),
        racecraftRatingRequirement: parsed.racecraftRatingRequirement !== undefined ? parsed.racecraftRatingRequirement : (existingRotationConfig.racecraftRatingRequirement || -1),
        maxCarSlots: parsed.maxCarSlots !== undefined ? parsed.maxCarSlots : (existingRotationConfig.maxCarSlots || 30),
        isRaceLocked: parsed.isRaceLocked !== undefined ? parsed.isRaceLocked : (existingRotationConfig.isRaceLocked || 0),
        shortFormationLap: parsed.shortFormationLap !== undefined ? parsed.shortFormationLap : (existingRotationConfig.shortFormationLap || 0),
        dumpLeaderboards: parsed.dumpLeaderboards !== undefined ? parsed.dumpLeaderboards : (existingRotationConfig.dumpLeaderboards || 0),
        dumpEntryList: parsed.dumpEntryList !== undefined ? parsed.dumpEntryList : (existingRotationConfig.dumpEntryList || 0),
        randomizeTrackWhenEmpty: parsed.randomizeTrackWhenEmpty !== undefined ? parsed.randomizeTrackWhenEmpty : (existingRotationConfig.randomizeTrackWhenEmpty || 0),
        allowAutoDQ: parsed.allowAutoDQ !== undefined ? parsed.allowAutoDQ : (existingRotationConfig.allowAutoDQ || 0),
        ignorePrematureDisconnects: parsed.ignorePrematureDisconnects !== undefined ? parsed.ignorePrematureDisconnects : (existingRotationConfig.ignorePrematureDisconnects || 0),
        formationLapType: parsed.formationLapType !== undefined ? parsed.formationLapType : (existingRotationConfig.formationLapType || 0),
        udpPort: parsed.udpPort !== undefined ? parsed.udpPort : (existingRotationConfig.udpPort || 9231),
        tcpPort: parsed.tcpPort !== undefined ? parsed.tcpPort : (existingRotationConfig.tcpPort || 9232),
        maxConnections: parsed.maxConnections !== undefined ? parsed.maxConnections : (existingRotationConfig.maxConnections || 32),
        lanDiscovery: parsed.lanDiscovery !== undefined ? parsed.lanDiscovery : (existingRotationConfig.lanDiscovery || 0),
        registerToLobby: parsed.registerToLobby !== undefined ? parsed.registerToLobby : (existingRotationConfig.registerToLobby || 0),
        rotation: parsed.rotation
      };

      fs.writeFileSync(ROTATION_CONFIG_PATH, JSON.stringify(rotationConfig, null, 2), 'utf8');

      res.writeHead(200);
      res.end('OK');
    });
  }

  else if (req.method === 'GET' && pathname === '/api/banlist') {
    let banData = { enabled: true, entries: [] };
    if (fs.existsSync(BANLIST_PATH)) {
      try {
        banData = JSON.parse(fs.readFileSync(BANLIST_PATH, 'utf8'));
      } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(banData));
  }

  else if (req.method === 'POST' && pathname === '/api/banlist') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        fs.writeFileSync(BANLIST_PATH, JSON.stringify(parsed, null, 2), 'utf8');

        // Sync entrylist.json immediately upon updating banlist
        syncEntrylistWithBanlist();

        res.writeHead(200);
        res.end('OK');
      } catch (err) {
        res.writeHead(500);
        res.end('Error saving banlist');
      }
    });
  }

  // API to list available session results JSON files sorted by date (newest 5 first)
  else if (req.method === 'GET' && pathname === '/api/results-files') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (!fs.existsSync(RESULTS_DIR)) {
      return res.end(JSON.stringify([]));
    }

    try {
      const files = fs.readdirSync(RESULTS_DIR)
        .filter(f => f.toLowerCase().endsWith('.json'))
        .map(f => {
          const fullPath = path.join(RESULTS_DIR, f);
          return { name: f, mtime: fs.statSync(fullPath).mtime.getTime() };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 6);

      res.end(JSON.stringify(files));
    } catch (err) {
      console.error('Error listing results files:', err);
      res.end(JSON.stringify([]));
    }
  }

  // API to parse session results for a specific file (or default to latest if unspecified)
  else if (req.method === 'GET' && (pathname === '/api/session-results' || pathname === '/api/latest-results')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    
    if (!fs.existsSync(RESULTS_DIR)) {
      return res.end(JSON.stringify({ message: 'results folder does not exist yet.' }));
    }

    try {
      const files = fs.readdirSync(RESULTS_DIR)
        .filter(f => f.toLowerCase().endsWith('.json'))
        .map(f => {
          const fullPath = path.join(RESULTS_DIR, f);
          return { name: f, path: fullPath, mtime: fs.statSync(fullPath).mtime.getTime() };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        return res.end(JSON.stringify({ message: 'No session results found in server/results folder.' }));
      }

      const fileNameParam = parsedUrl.searchParams.get('file');
      let targetFile = files[0];

      if (fileNameParam) {
        const found = files.find(f => f.name === path.basename(fileNameParam));
        if (found) targetFile = found;
      }

      const resultData = readJsonFileSync(targetFile.path);
      const driversMap = new Map();

      if (Array.isArray(resultData.sessionResult && resultData.sessionResult.leaderBoardLines)) {
        resultData.sessionResult.leaderBoardLines.forEach(line => {
          if (line.car && Array.isArray(line.car.drivers)) {
            line.car.drivers.forEach(d => {
              const pId = String(d.playerId || d.playerID || '');
              if (pId && !driversMap.has(pId)) {
                const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unknown Driver';
                driversMap.set(pId, { name: fullName, playerId: pId });
              }
            });
          }
        });
      }

      const driversList = Array.from(driversMap.values());

      res.end(JSON.stringify({
        filename: targetFile.name,
        trackName: resultData.trackName || '',
        sessionType: resultData.sessionType || '',
        drivers: driversList
      }));

    } catch (err) {
      console.error('Error reading session results:', err);
      res.end(JSON.stringify({ message: 'Error reading session results file: ' + err.message }));
    }
  }

  else if (req.method === 'GET' && pathname === '/api/script/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getStatus()));
  }
  
  else if (req.method === 'POST' && pathname === '/api/script/start') {
    syncEntrylistWithBanlist();
    startRotation();
    res.writeHead(200);
    res.end('Started Rotation Mode');
  }

  else if (req.method === 'POST' && pathname === '/api/script/start-normal') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      let trackIndex = 0;
      try {
        const parsed = JSON.parse(body);
        if (parsed.trackIndex !== undefined) trackIndex = parsed.trackIndex;
      } catch (e) {}
      
      syncEntrylistWithBanlist();
      startNormal(trackIndex);
      res.writeHead(200);
      res.end('Started Normal Mode');
    });
  }
  
  else if (req.method === 'POST' && pathname === '/api/script/stop') {
    await stopRotation();
    res.writeHead(200);
    res.end('Stopped');
  }

  else if (req.method === 'POST' && pathname === '/api/app/shutdown') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Shutting down application...');
    
    // Stop ACC server process if active, then kill the Node process
    try {
      await stopRotation();
    } catch (e) {}

    setTimeout(() => {
      process.exit(0);
    }, 500);
  }
  
  else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('ACC Session Manager GUI Running at http://127.0.0.1:3030');
});