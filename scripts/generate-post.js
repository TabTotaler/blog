import fs from 'fs';
import path from 'path';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY environment variable.");
  process.exit(1);
}

// Helper to parse CSV properly handling quotes and commas
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const result = [];

  for (let i = 1; i < lines.length; i++) {
    const currentLine = lines[i];
    const values = [];
    let inQuotes = false;
    let currentValue = '';

    for (let char of currentLine) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(currentValue.trim().replace(/^["']|["']$/g, ''));
        currentValue = '';
      } else {
        currentValue += char;
      }
    }
    values.push(currentValue.trim().replace(/^["']|["']$/g, ''));

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    if (row.name) {
      result.push(row);
    }
  }
  return result;
}

function getFullName(drink) {
  return drink.brand ? `${drink.brand} ${drink.name}` : drink.name;
}

async function run() {
  const csvPath = path.join(process.cwd(), 'src', 'data', 'drinks.csv');
  if (!fs.existsSync(csvPath)) {
    console.error("drinks.csv not found in src/data/!");
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  let drinks = parseCSV(csvText);

  if (drinks.length < 2) {
    console.log("Not enough drinks in the CSV database!");
    return;
  }

  // Randomly decide post type:
  // 70% chance: Single Drink Spotlight
  // 30% chance: Pairing / Combination (e.g. Beer & Shot or Two Drink Comparison)
  const isPairingPost = Math.random() < 0.3;

  let prompt = "";
  let slug = "";
  let usedIndices = [];

  if (isPairingPost && drinks.length >= 2) {
    // Pick two different drinks for a pairing/comparison post
    const index1 = 0;
    const index2 = Math.floor(Math.random() * (drinks.length - 1)) + 1;
    
    const drink1 = drinks[index1];
    const drink2 = drinks[index2];
    
    const name1 = getFullName(drink1);
    const name2 = getFullName(drink2);

    console.log(`Generating Pairing/Comparison post for: ${name1} & ${name2}`);

    slug = `pairing-${drink1.id || 'drink1'}-and-${drink2.id || 'drink2'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    prompt = `You are an expert mixologist and beverage curator writing for the TabTotaler mobile app blog. 
Write an 800-word SEO-optimized blog post exploring the ultimate drink combination and pairing of **${name1}** and **${name2}**.

Drink 1 Details:
- Name: ${name1}
- Category: ${drink1.category || 'Beverage'}
- ABV: ${drink1.abv ? drink1.abv + '%' : 'N/A'}
- Calories: ${drink1.kcal ? drink1.kcal + ' kcal' : 'N/A'}

Drink 2 Details:
- Name: ${name2}
- Category: ${drink2.category || 'Beverage'}
- ABV: ${drink2.abv ? drink2.abv + '%' : 'N/A'}
- Calories: ${drink2.kcal ? drink2.kcal + ' kcal' : 'N/A'}

Format the output strictly as Markdown with YAML frontmatter at the top like this:
---
title: "The Ultimate Pairing: ${name1} Meets ${name2}"
pubDate: "${new Date().toISOString().split('T')[0]}"
description: "Discover why ${name1} and ${name2} make an incredible flavor combination, and how to track your drinks responsibly using TabTotaler."
---

[Write an engaging, SEO-optimized blog article body explaining why these two beverages complement each other (e.g., a classic beer and a shot pairing, or complementary flavor notes), tasting notes, pacing tips, and a closing call-to-action inviting readers to download the TabTotaler app on iOS and Android.]`;

    usedIndices = [index1, index2];

  } else {
    // Single Drink Spotlight
    const drink = drinks[0];
    const drinkFullName = getFullName(drink);
    console.log(`Generating Single Drink post for: ${drinkFullName}`);

    slug = (drink.id || drinkFullName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    prompt = `You are a professional mixologist and SEO blogger writing for our drink-tracking mobile app TabTotaler. 
Write an 800-word SEO-optimized blog post about "${drinkFullName}".

Drink details:
- Name: ${drinkFullName}
- Category: ${drink.category || 'Beverage'}
- ABV: ${drink.abv ? drink.abv + '%' : 'N/A'}
- Calories: ${drink.kcal ? drink.kcal + ' kcal' : 'N/A'}
- Typical Serving: ${drink.servingKind || 'standard pour'}

Format the output strictly as Markdown with YAML frontmatter at the top like this:
---
title: "Everything You Need to Know About ${drinkFullName}"
pubDate: "${new Date().toISOString().split('T')[0]}"
description: "Discover the flavor profile, nutritional details, ABV, and serving style of ${drinkFullName} on TabTotaler."
---

[Write an engaging, SEO-optimized blog article body including an introduction, profile/flavor notes, nutritional & ABV considerations, best serving suggestions, and a closing call-to-action inviting readers to log and track their drinks with the TabTotaler mobile app on iOS and Android.]`;

    usedIndices = [0];
  }

  // Call Gemini API
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const data = await response.json();
  if (!data.candidates || data.candidates.length === 0) {
    console.error("Failed to generate content from Gemini:", JSON.stringify(data));
    process.exit(1);
  }

  const markdownContent = data.candidates[0].content.parts[0].text;

  // Save markdown file to Astro content collection
  const postPath = path.join(process.cwd(), 'src', 'content', 'blog', `${slug}.md`);
  fs.writeFileSync(postPath, markdownContent, 'utf8');
  console.log(`Saved new post to ${postPath}`);

  // Rotate used drinks to the back of the CSV queue so content stays fresh
  const headers = Object.keys(drinks[0]);
  usedIndices.sort((a, b) => b - a).forEach(idx => {
    const item = drinks.splice(idx, 1)[0];
    drinks.push(item);
  });

  let newCsvContent = headers.join(',') + '\n';
  drinks.forEach(d => {
    const row = headers.map(h => `"${(d[h] || '').replace(/"/g, '""')}"`).join(',');
    newCsvContent += row + '\n';
  });

  fs.writeFileSync(csvPath, newCsvContent, 'utf8');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
