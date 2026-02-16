import json
import re

with open('apps_output.json', 'r', encoding='utf-8') as f:
    apps = json.load(f)

# Patterns for apps to exclude (case-insensitive)
exclude_patterns = [
    # System/Windows components
    r'^microsoft\s*(edge\s*)?update',
    r'^windows\s*(app|sdk|kit|installer|defender)',
    r'^microsoft\s*(visual\s*c\+\+|\.net|asp\.net|web)',
    r'^\.net\s*(runtime|desktop|host|framework)',
    r'^vc_?redist',
    r'^msvc',
    r'^vcredist',

    # Runtimes and frameworks
    r'^java\s*(tm|se|runtime|development|update)',
    r'^oracle\s*java',
    r'^node\.?js$',
    r'^nodejs$',
    r'^python\s*\d',
    r'^php\s*\d',
    r'^ruby\s*\d',
    r'^go\s*programming',
    r'^rust\s*(programming)?',

    # Package managers and dev tools (unless main app)
    r'^npm',
    r'^chocolatey',
    r'^winget',
    r'^scoop',
    r'^pip\s',

    # Drivers and hardware
    r'driver',
    r'^nvidia\s*(graphics|physx|geforce\s*experience)',
    r'^amd\s*(radeon|software|chipset)',
    r'^intel\s*(graphics|management|rapid|wireless)',
    r'^realtek',
    r'^synaptics',
    r'^logitech\s*(unifying|options|gaming)',

    # Updaters, helpers, services
    r'update(r|service)?$',
    r'helper$',
    r'^helper\s',
    r'service$',
    r'^service\s',
    r'uninstall',
    r'^setup\s',
    r'installer$',
    r'redistributable',
    r'runtime$',
    r'^repair\s',
    r'^remove\s',

    # Microsoft Office components (not main apps)
    r'^microsoft\s*(office\s*)?(click-to-run|onenote\s*for)',
    r'^office\s*\d+\s*(click|upload|telemetry)',

    # Common bloatware/utilities
    r'^bonjour$',
    r'^apple\s*(mobile\s*device|software\s*update|application)',
    r'^adobe\s*(creative\s*cloud|genuine|arm|flash)',
    r'^autodesk\s*(genuine|desktop)',

    # Browser components (not main browsers)
    r'^google\s*update',
    r'^chrome\s*components',
    r'^firefox\s*maintenance',

    # Repair tools and diagnostics
    r'diagnostic',
    r'troubleshoot',
    r'^repair\s',

    # Very short or cryptic names (likely internal tools)
    r'^[a-z]{1,3}$',
    r'^[0-9]+$',

    # SDK and development tools users don't launch directly
    r'\bsdk\b',
    r'\bapi\b',
    r'^tools\s*for',
    r'\bcomponent\b',

    # Additional patterns for this list
    r'^administrative\s*tools',
    r'^character\s*map',
    r'^command\s*prompt$',
    r'^console$',
    r'^disk\s*cleanup',
    r'^magnify',
    r'^memory\s*diagnostics',
    r'^narrator',
    r'^on-screen\s*keyboard',
    r'^registry\s*editor',
    r'^remote\s*desktop\s*connection',
    r'^resource\s*monitor',
    r'^steps\s*recorder',
    r'^system\s*(configuration|information)',
    r'^task\s*manager',
    r'^odbc\s*data',
    r'^telemetry',
    r'^iscsi\s*initiator',
    r'^dfrgui',
    r'^windows\s*(fax|mail|media\s*player|photo|powershell)',
    r'^recovery\s*drive',
    r'^app\s*recovery',
    # Package family names - be more specific to avoid catching legitimate apps
    r'_8wekyb3d8bbwe$',  # Microsoft UWP apps
    r'_cw5n1h2txyewy$',  # Windows CBS
    r'_qmba6cd70vzyy$',  # ASUS apps
    r'_79rhkp1fndgsc$',  # Canonical Ubuntu
    r'_qbz5n2kfra8p0$',  # Python Foundation
    r'_0a9344xs7nr4m$',  # AMD apps
    r'^about\s*java',
    r'^configure\s*java',
    r'^idle\s*\(python',
    r'module\s*docs',
    r'^antigravity',
    r'^python\s*access',
    r'^developer\s*(command|powershell)',
    r'^x64.*tools\s*command',
    r'^x86.*tools\s*command',
    r'^native\s*tools',
    r'^cross\s*tools',
    r'^cloud\s*tools',
    r'^application\s*verifier',
    r'^debuggable',
    r'(compare|spreadsheet\s*compare|database\s*compare)$',
    r'^office\s*language',
    r'^send\s*to\s*onenote',
    r'^skype.*recording',
    r'error\s*reporter',
    r'^nvidia\s*(container|frameview)',
    r'^lightingservice',
    r'^livecaptions',
    r'^voiceaccess',
    r'^ttsapp',
    r'^wondershare',
    r'^espeak',
    r'^dotnet$',
    r'autostart',
    r'^riot\s*vanguard',
    r'^riot\s*client\s*$',  # Riot Client with trailing space
    r'^bluestacks\s*(services|multi-instance|store|x$|_nxt)',
    r'bluestacks-services',
    r'^internet\s*explorer',
    r'^microsoft\s*silverlight',
    r'^asus',
    r'^sticky\s*notes',
    r'^fast\s*node\s*manager',
    r'^razer\s*cortex',  # Background game booster
    r'autostart',
    r'^play\s+',  # "Play Tekken 8" - just use "Tekken 8"
    r'^windows\s*software\s*development',  # SDK
    r'^anaconda\s*(prompt|powershell)',  # Command line tools
    r'^git\s*cmd$',  # Keep Git, Git Bash, and Git GUI
]

# Names to always include (popular apps that might match exclude patterns)
always_include = [
    r'^visual\s*studio\s*(code|community|professional|enterprise)?$',
    r'^vs\s*code$',
    r'^microsoft\s*vs\s*code',
    r'^microsoft\s*visual\s*studio\s*code',
    r'^android\s*studio$',
    r'^intellij',
    r'^pycharm',
    r'^webstorm',
    r'^rider$',
    r'^datagrip',
    r'^node\.js\s*command',
    r'^git\s*(bash|gui|cmd)$',
    r'^git$',
    r'^github\s*desktop$',
    r'^docker\s*desktop$',
    r'^postman',
    r'^insomnia',
    r'^figma',
    r'^adobe\s*(photoshop|illustrator|premiere|after\s*effects|xd|acrobat|lightroom)',
    r'^microsoft\s*(word|excel|powerpoint|outlook|teams|onenote|access|publisher|visio)$',
    r'^(word|excel|powerpoint|outlook|onenote|access|publisher)$',
    r'^outlook\s*\(classic\)',
    r'^office\s*(word|excel|powerpoint)',
    r'^google\s*(chrome|drive|earth)',
    r'^mozilla\s*firefox$',
    r'^brave',
    r'^opera',
    r'^microsoft\s*edge$',
    r'^discord$',
    r'^slack$',
    r'^zoom',
    r'^spotify$',
    r'^steam$',
    r'^epic\s*games',
    r'^origin$',
    r'^battle\.net',
    r'^vlc',
    r'^obs\s*studio',
    r'^audacity',
    r'^gimp',
    r'^blender',
    r'^unity\s*(hub|editor)?$',
    r'^unreal\s*(engine|editor)',
    r'^notion$',
    r'^obsidian$',
    r'^todoist',
    r'^1password',
    r'^bitwarden',
    r'^lastpass',
    r'^keepass',
    r'^libreoffice',
    r'^notepad\+\+',
    r'^cursor',
    r'^windsurf',
    r'^dbeaver',
    r'^beyond\s*compare',
    r'^bluestacks\s*5$',
    r'^nvidia\s*app',
    r'^ea$',
    r'^riot\s*client$',  # Main Riot Client (no trailing space)
    r'^valorant',
    r'^ollama',
    r'^redis\s*insight',
    r'^canva',
    r'^capcut',
    r'^stremio',
    r'^streamlabs',
    r'^winrar',
    r'^popcorn\s*time',
    r'^utorrent',
    r'^pinokio',
    r'^comet',
    r'^pluely',
    r'^convertify',
    r'^vital$',
    r'^ivcam',
    r'^remote\s*mouse$',
    r'^unified\s*remote$',
    r'^turbovpn',
    r'^powertoys',
    r'^wsl$',
    r'^ableton\s*live',  # Main app only
    r'^ab\s*download',
    r'^mortal\s*kombat',
    r'^tekken\s*\d',
    r'^fifa\s*\d',
    r'^skype\s*for\s*business$',
    r'^tesseract',
    r'^arc',  # Arc browser
    r'^chatgpt',  # ChatGPT desktop
    r'\barc_',  # Arc with package family name
    r'chatgpt.*desktop',  # ChatGPT variants
    r'^cursor',  # Cursor editor (all variants)
    r'^windsurf',  # Windsurf editor (all variants)
    r'^microsoft\s*visual\s*studio\s*code',  # VS Code (all variants)
    r'^windows\s*terminal',  # Windows Terminal
    r'^terminal$',  # Terminal
    r'^notepad$',  # Windows Notepad
    r'^paint$',  # Microsoft Paint
    r'^store$',  # Microsoft Store
    r'^calculator$',  # Calculator
]

def should_include(name):
    if not name or len(name) < 2:
        return False

    # Check always include first
    for pattern in always_include:
        if re.search(pattern, name, re.IGNORECASE):
            return True

    # Check exclude
    for pattern in exclude_patterns:
        if re.search(pattern, name, re.IGNORECASE):
            return False

    return True

# First pass: apply pattern filter
filtered_pass1 = [a for a in apps if should_include(a['name'])]

# Second pass: deduplicate - keep shorter name when there's a version variant
def deduplicate_apps(apps_list):
    # Group by base name (remove version-like suffixes)
    name_groups = {}
    for app in apps_list:
        name = app['name']
        # Create base name by removing version patterns
        base = re.sub(r'\s*version\s*\d+(\.\d+)*\s*$', '', name, flags=re.IGNORECASE)  # Remove "version X.Y.Z"
        base = re.sub(r'\s+\d+(\.\d+)+\s*$', '', base)  # Remove trailing versions like "1.2.3"
        base = re.sub(r'\s*\(\d+-?bit\)', '', base)  # Remove (32-bit) or (64-bit)
        base = re.sub(r'\s+x\d+\s+\d+(\.\d+)*\s*$', '', base, flags=re.IGNORECASE)  # Remove "x64 11.76.9"
        base = re.sub(r'\s*\(preview\)\s*$', '', base, flags=re.IGNORECASE)  # Remove (Preview)
        base = re.sub(r'\s*\(safe\s*mode\)\s*$', '', base, flags=re.IGNORECASE)  # Remove (Safe Mode)
        base = re.sub(r'_[a-z0-9]{13,}$', '', base, flags=re.IGNORECASE)  # Remove UWP package suffixes
        base = re.sub(r'\s*\(user\)\s*$', '', base, flags=re.IGNORECASE)  # Remove (User) for grouping
        base = re.sub(r'\s+x64\s*$', '', base, flags=re.IGNORECASE)  # Remove x64
        base = base.strip().lower()

        if base not in name_groups:
            name_groups[base] = []
        name_groups[base].append(app)

    # For each group, pick the best one
    result = []
    for base, group in name_groups.items():
        if len(group) == 1:
            result.append(group[0])
        else:
            # Prefer (User) variants for user-installed apps, otherwise pick shortest clean name
            user_variants = [app for app in group if '(user)' in app['name'].lower()]
            if user_variants:
                # Pick the shortest (User) variant
                user_variants.sort(key=lambda x: len(x['name']))
                result.append(user_variants[0])
            else:
                # Sort by length, pick shortest
                group.sort(key=lambda x: len(x['name']))
                result.append(group[0])

    return result

filtered = deduplicate_apps(filtered_pass1)
excluded = [a for a in apps if a not in filtered]

print(f'Total: {len(apps)} -> Filtered: {len(filtered)} (removed {len(excluded)})')
print()
print('=== INCLUDED APPS ===')
for a in sorted(filtered, key=lambda x: x['name'].lower()):
    print(f'  + {a["name"]}')

print()
print('=== EXCLUDED APPS ===')
for a in sorted(excluded, key=lambda x: x['name'].lower()):
    print(f'  - {a["name"]}')
