require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const REC_ITEM = {
  type: 'object',
  properties: {
    title:   { type: 'string' },
    year:    { type: 'integer' },
    creator: { type: 'string' },
    reason:  { type: 'string', description: 'Személyes, konkrét indoklás 3-5 mondatban' },
  },
  required: ['title', 'year', 'creator', 'reason'],
};

const RECOMMEND_TOOL = {
  name: 'return_recommendations',
  description: 'Return the taste profile analysis and separate book and film recommendations.',
  input_schema: {
    type: 'object',
    properties: {
      taste_profile: {
        type: 'string',
        description: '2-3 mondatos elemzés az ízlésről -- mi a közös szál?',
      },
      books: {
        type: 'array',
        description: '5 könyvajánlás',
        items: REC_ITEM,
        minItems: 5,
        maxItems: 5,
      },
      films: {
        type: 'array',
        description: '5 filmajánlás',
        items: REC_ITEM,
        minItems: 5,
        maxItems: 5,
      },
    },
    required: ['taste_profile', 'books', 'films'],
  },
};

function buildPrompt(favorites) {
  const favoritesText = favorites
    .map((f, i) => `${i + 1}. "${f.title}" (${f.type === 'book' ? 'könyv' : 'film'}) -- Miért szeretted: ${f.why}`)
    .join('\n');

  return `Te egy rendkívül érzékeny irodalmi és filmkritikus vagy. A feladatod nem az, hogy "ha ezt szereted, akkor ezt is fogod" logikával ajánlj -- hanem hogy felismerd az ízlés mögöttes mintázatait és meglepő, de tökéletesen rezonáló ajánlásokat adj.

A felhasználó kedvencei:
${favoritesText}

ELEMZÉSI FELADAT -- koncentrálj ezekre:
- Milyen érzelmi állapotot keresett bennük? (menekülés, megrendülés, nosztalgia, intellektuális izgalom...)
- Milyen karaktereket szeret? (törékeny de erős, morálisan komplex, csendes megfigyelő...)
- Milyen atmoszféra vonzza? (melankólia, feszültség, meleg humor, hideg távolságtartás...)
- Milyen témák térnek vissza? (identitás, veszteség, összetartozás, szabadság...)
- Milyen narratív stílust preferál? (lassú kibontakozás, csavaros szerkezet, lírai próza...)

AJÁNLÁSI SZABÁLYOK:
- Adj 5 könyvajánlást és 5 filmajánlást külön-külön
- Legalább 2-2 legyen meglepő -- más műfaj, más korszak, más kultúra, de mélyen rezonáló
- SOHA ne magyarázd műfaji hasonlósággal -- mutasd meg a mélyebb érzelmi/tematikai rezgést
- Az indoklás legyen személyes és konkrét, nem általános dicséret

Hívd meg a return_recommendations eszközt az eredménnyel.`;
}

app.post('/recommend', async (req, res) => {
  const { favorites } = req.body;

  if (!favorites || favorites.length === 0) {
    return res.status(400).json({ error: 'Adj meg legalább egy kedvencet.' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      tools: [RECOMMEND_TOOL],
      tool_choice: { type: 'tool', name: 'return_recommendations' },
      messages: [{ role: 'user', content: buildPrompt(favorites) }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) {
      return res.status(500).json({ error: 'Nem sikerült ajánlásokat generálni.' });
    }

    res.json(toolUse.input);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba a Claude API hívásakor: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Könyv/Film Koktél szerver fut: http://localhost:${PORT}`);
});
