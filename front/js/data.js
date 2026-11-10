/**
 * data.js
 * Mirrors the original Python app's data structures and logic exactly.
 *
 * Hosts    = []   (List of Dictionaries)
 * Users    = []   (List of Dictionaries)
 * Machines = {}   (Dictionary of Dictionaries with set for Users)
 *
 * All data stored in sessionStorage to persist across page navigation.
 */

const KEYS = {
  hosts:    'vmcalc_hosts',
  users:    'vmcalc_users',
  machines: 'vmcalc_machines',
};

function getState() {
  return {
    hosts:    JSON.parse(sessionStorage.getItem(KEYS.hosts)    || '[]'),
    users:    JSON.parse(sessionStorage.getItem(KEYS.users)    || '[]'),
    machines: JSON.parse(sessionStorage.getItem(KEYS.machines) || '{}'),
  };
}

function saveHosts(hosts)       { sessionStorage.setItem(KEYS.hosts,    JSON.stringify(hosts));    }
function saveUsers(users)       { sessionStorage.setItem(KEYS.users,    JSON.stringify(users));    }
function saveMachines(machines) { sessionStorage.setItem(KEYS.machines, JSON.stringify(machines)); }

function clearAllData() {
  sessionStorage.removeItem(KEYS.hosts);
  sessionStorage.removeItem(KEYS.users);
  sessionStorage.removeItem(KEYS.machines);
}

/**
 * Menu_Option5 — load dummy data.
 * Original code always REPLACES (no append mode).
 * Mirrors exact dummy data from Menu_Option_5_DummyData.py
 */
function Menu_Option5() {
  const Hosts = [
    { Name: 'Esxi',   CPU: 200, Memory: 1000, Storage: 3000, Count: 5  },
    { Name: 'Dell',   CPU: 400, Memory: 1600, Storage: 5000, Count: 10 },
    { Name: 'Lenovo', CPU: 500, Memory: 2500, Storage: 9000, Count: 4  },
  ];
  const Users = [
    { Name: 'OfficeUsers', Count: 1000 },
    { Name: 'Developers',  Count: 100  },
    { Name: 'IT',          Count: 35   },
    { Name: 'Managers',    Count: 50   },
  ];
  // Machines: dictionary of dicts, Users stored as array (mirrors Python set)
  const Machines = {
    Office: { CPU: 4,  Memory: 8,  Storage: 80,  Users: ['OfficeUsers'] },
    Dev:    { CPU: 32, Memory: 64, Storage: 300, Users: ['Developers']  },
    IT:     { CPU: 8,  Memory: 16, Storage: 150, Users: ['IT', 'Managers'] },
  };
  saveHosts(Hosts);
  saveUsers(Users);
  saveMachines(Machines);
}

/**
 * Menu_Option4 — calculator.
 * Mirrors EXACTLY the original First-Fit algorithm from Menu_Option_4_Calcultaor.py:
 *   - Add count to each machine type based on users list
 *   - Add 80% usable resources to each host (rounded down)
 *   - Expand hosts to individual servers (Hosts_seperated)
 *   - For each VM needed: scan from Host #1 every time, place in first host that fits
 *   - Print summary + missing resources
 */
function Menu_Option4(Hosts, Users, Machines) {

  // Add count to each machine type (sum of assigned user populations)
  for (const Machine_type in Machines) {
    let Count = 0;
    const userSet = Machines[Machine_type]['Users'] || [];
    for (const i of userSet) {
      if (i === 'No populations assigned') {
        // count = 0
      } else {
        for (const u of Users) {
          if (u['Name'] === i) {
            Count = Count + u['Count'];
          }
        }
      }
    }
    Machines[Machine_type]['Count'] = Count;
  }

  // Add 80% of each parameter as a new parameter to each host type
  for (const Host of Hosts) {
    Host['CPU_to_use']     = Math.floor(0.8 * Host['CPU']);
    Host['Memory_to_use']  = Math.floor(0.8 * Host['Memory']);
    Host['Storage_to_use'] = Math.floor(0.8 * Host['Storage']);
  }

  // Create Hosts_seperated: one entry per individual server
  const Hosts_seperated = [];
  for (const Host of Hosts) {
    for (let i = 0; i < Host['Count']; i++) {
      const Host_seperated = {};
      const name = Host['Name'] + ' server #' + (i + 1);
      Host_seperated['Name']    = name;
      Host_seperated['CPU']     = Host['CPU_to_use'];
      Host_seperated['Memory']  = Host['Memory_to_use'];
      Host_seperated['Storage'] = Host['Storage_to_use'];
      Hosts_seperated.push(Host_seperated);
    }
  }

  // Create Host_Dict: one entry per individual server
  const Host_Dict = {};
  for (const Host_seperated of Hosts_seperated) {
    Host_Dict[Host_seperated['Name']] = {};
  }

  // First-Fit: for each VM, scan from Host #1 every time
  for (const Machine_type in Machines) {
    const Total_vms_needed = Machines[Machine_type]['Count'];
    if (Total_vms_needed === 0) continue;

    for (let i = 0; i < Total_vms_needed; i++) {
      for (const Host_seperated of Hosts_seperated) {
        const CPU_New  = Host_seperated['CPU']     - Machines[Machine_type]['CPU'];
        const Mem_New  = Host_seperated['Memory']  - Machines[Machine_type]['Memory'];
        const Strg_New = Host_seperated['Storage'] - Machines[Machine_type]['Storage'];

        if (CPU_New >= 0 && Mem_New >= 0 && Strg_New >= 0) {
          Host_seperated['CPU']     = CPU_New;
          Host_seperated['Memory']  = Mem_New;
          Host_seperated['Storage'] = Strg_New;
          const Current_count = Host_Dict[Host_seperated['Name']][Machine_type] || 0;
          Host_Dict[Host_seperated['Name']][Machine_type] = Current_count + 1;
          break; // place in first available, then move to next VM
        }
      }
    }
  }

  return { Hosts_seperated, Host_Dict, Machines };
}
