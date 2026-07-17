const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const IN_FILE = path.join(REPO_ROOT, 'evolution_history_full.md');
const OUT_FILE = path.join(REPO_ROOT, 'evolution_human_summary.md');

function generateHumanReport() {
    if (!fs.existsSync(IN_FILE)) return console.error("No input file");

    const content = fs.readFileSync(IN_FILE, 'utf8');
    const entries = content.split('---').map(e => e.trim()).filter(e => e.length > 0);

    const categories = {
        'Security & Stability': [],
        'Performance & Optimization': [],
        'Tooling & Features': [],
        'Documentation & Process': []
    };

    const componentMap = {}; // Component -> Change List

    entries.forEach(entry => {
        // Extract basic info
        const lines = entry.split('\n');
        const header = lines[0]; // ### Title (Date)
        const body = lines.slice(1).join('\n');
        
        const dateMatch = header.match(/\((.*?)\)/);
        const dateStr = dateMatch ? dateMatch[1] : '';
        const time = dateStr.split(' ')[1] || ''; // HH:mm:ss

        // Classify
        let category = 'Tooling & Features';
        let component = 'System';
        let summary = '';

        const lowerBody = body.toLowerCase();

        // Detect Component
        if (lowerBody.includes('feishu-card')) component = 'feishu-card';
        else if (lowerBody.includes('feishu-sticker')) component = 'feishu-sticker';
        else if (lowerBody.includes('git-sync')) component = 'git-sync';
        else if (lowerBody.includes('capability-evolver') || lowerBody.includes('evolve.js')) component = 'capability-evolver';
        else if (lowerBody.includes('interaction-logger')) component = 'interaction-logger';
        else if (lowerBody.includes('chat-to-image')) component = 'chat-to-image';
        else if (lowerBody.includes('safe_publish')) component = 'capability-evolver';

        // Detect Category
        if (lowerBody.includes('security') || lowerBody.includes('permission') || lowerBody.includes('auth') || lowerBody.includes('harden')) {
            category = 'Security & Stability';
        } else if (lowerBody.includes('optimiz') || lowerBody.includes('performance') || lowerBody.includes('memory') || lowerBody.includes('fast')) {
            category = 'Performance & Optimization';
        } else if (lowerBody.includes('doc') || lowerBody.includes('readme')) {
            category = 'Documentation & Process';
        }

        // Extract Human Summary (First meaningful line that isn't Status/Action/Date)
        const summaryLines = lines.filter(l => 
            !l.startsWith('###') && 
            !l.startsWith('Status:') && 
            !l.startsWith('Action:') &&
            l.trim().length > 10
        );
        
        if (summaryLines.length > 0) {
            // Clean up the line
            summary = summaryLines[0]
                .replace(/^-\s*/, '') // Remove bullets
                .replace(/\*\*/g, '') // Remove bold
                .replace(/`/, '')
                .trim();
                
            // Deduplicate
            const key = `${component}:${summary.substring(0, 20)}`;
            const exists = categories[category].some(i => i.key === key);
            
            if (!exists && !summary.includes("Stability Scan OK") && !summary.includes("Workspace Sync")) {
                categories[category].push({ time, component, summary, key });
                
                if (!componentMap[component]) componentMap[component] = [];
                componentMap[component].push(summary);
            }
        }
    });

    // --- Generate Markdown ---
    const today = new Date().toISOString().slice(0, 10);
    let md = `# Evolution Summary: The Day in Review (${today})\n\n`;
    md += `> Overview: Grouped summary of changes extracted from evolution history.\n\n`;

    // Section 1: By Theme (Evolution Direction)
    md += `## 1. Evolution Direction\n`;
    
    for (const [cat, items] of Object.entries(categories)) {
        if (items.length === 0) continue;
        md += `### ${cat}\n`;
        // Group by component within theme
        const compGroup = {};
        items.forEach(i => {
            if (!compGroup[i.component]) compGroup[i.component] = [];
            compGroup[i.component].push(i.summary);
        });
        
        for (const [comp, sums] of Object.entries(compGroup)) {
            // Unique summaries only
            const uniqueSums = [...new Set(sums)];
            uniqueSums.forEach(s => {
                md += `- **${comp}**: ${s}\n`;
            });
        }
        md += `\n`;
    }

    // Section 2: By Timeline (High Level)
    md += `## 2. Timeline of Critical Events\n`;
    // Flatten and sort all items by time
    const allItems = [];
    Object.values(categories).forEach(list => allItems.push(...list));
    allItems.sort((a, b) => a.time.localeCompare(b.time));
    
    // Filter for "Critical" keywords
    const criticalItems = allItems.filter(i => 
        i.summary.toLowerCase().includes('fix') || 
        i.summary.toLowerCase().includes('patch') ||
        i.summary.toLowerCase().includes('create') ||
        i.summary.toLowerCase().includes('optimiz')
    );

    criticalItems.forEach(i => {
        md += `- \`${i.time}\` (${i.component}): ${i.summary}\n`;
    });

    // Section 3: Package Adjustments
    md += `\n## 3. Package & Documentation Adjustments\n`;
    const comps = Object.keys(componentMap).sort();
    comps.forEach(comp => {
        const count = new Set(componentMap[comp]).size;
        md += `- **${comp}**: Received ${count} significant updates.\n`;
    });

    fs.writeFileSync(OUT_FILE, md);
    console.log("Human report generated.");
}

generateHumanReport();

