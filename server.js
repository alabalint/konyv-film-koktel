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
    reason:  { type: 'string' },
  },
  required: ['title', 'year', 'creator', 'reason'],
};

const RECOMMEND_TOOL = {
  name: 'return_recommendations',
  description: 'Return the taste profile analysis and separate book and film recommendations.',
  input_schema: {
    type: 'object',
    properties: {
      taste_profile: { type: 'string' },
      books: { type: 'array', items: REC_ITEM, minItems: 5, maxItems: 5 },
      films: { type: 'array', items: REC_ITEM, minItems: 5, maxItems: 5 },
    },
    required: ['taste_profile', 'books', 'films'],
  },
};

const MORE_TOOL = {
  name: 'return_more',
  description: 'Return additional recommendations of the requested type.',
  input_schema: {
    type: 'object',
    properties: {
      items: { type: 'array', items: REC_ITEM, minItems: 3, maxItems: 3 },
    },
    required: ['items'],
  },
};

const MOOD_LABELS = {
  light:     'Könnyű, szórakoztató, felszabadító hangulat',
  medium:    'Kiegyensúlyozott -- sem túl könnyű, sem túl nehéz',
  deep:      'Mély, elgondolkodtató, érzelmileg megterhelő is lehet',
  exciting:  'Feszültségteli, izgalmas, lehessen letenni se',
};

function buildPrompt(favorites, mood) {
  const favoritesText = favorites
    .map((f, i) => `${i + 1}. "${f.title}" (${f.type === 'book' ? 'könyv' : 'film'}) -- Miért szeretted: ${f.why}`)
    .join('\n');

  const moodLine = mood && MOOD_LABELS[mood]
    ? `\nHANGULAT KÉRÉS: A felhasználó most olyan ajánlást szeretne, ami: ${MOOD_LABELS[mood]}\n`
    : '';

  return `Te egy rendkívül érzékeny irodalmi és filmkritikus vagy. A feladatod nem az, hogy "ha ezt szereted, akkor ezt is fogod" logikával ajánlj -- hanem hogy felismerd az ízlés mögöttes mintázatait és meglepő, de tökéletesen rezonáló ajánlásokat adj.

A felhasználó kedvencei:
${favoritesText}
${moodLine}
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

function buildMorePrompt(favorites, existing, type, mood, ratings) {
  const favoritesText = favorites
    .map((f, i) => `${i + 1}. "${f.title}" (${f.type === 'book' ? 'könyv' : 'film'}) -- Miért szeretted: ${f.why}`)
    .join('\n');

  const existingText = existing
    .map((r, i) => {
      const rating = ratings?.[r.title];
      const ratingStr = rating === 'up' ? ' [TETSZETT]' : rating === 'down' ? ' [NEM TETSZETT]' : '';
      return `- ${r.title} (${r.creator}, ${r.year})${ratingStr}`;
    })
    .join('\n');

  const moodLine = mood && MOOD_LABELS[mood]
    ? `\nHANGULAT KÉRÉS: ${MOOD_LABELS[mood]}\n`
    : '';

  return `Te egy irodalmi és filmkritikus vagy. A felhasználónak már adtál ajánlásokat, most 3 újabbat kér ${type === 'book' ? 'könyvből' : 'filmből'}.

Kedvencei:
${favoritesText}
${moodLine}
Már ajánlott ${type === 'book' ? 'könyvek' : 'filmek'} (NE ajánld újra ezeket, és a [NEM TETSZETT] jelzésekből tanulj):
${existingText}

Adj 3 új, különböző ajánlást -- a korábbiaktól eltérő irányból közelítve, de ugyanolyan mélyen rezonálva. Hívd meg a return_more eszközt.`;
}

app.post('/recommend', async (req, res) => {
  const { favorites, mood } = req.body;
  if (!favorites?.length) return res.status(400).json({ error: 'Adj meg legalább egy kedvencet.' });

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 5000,
      thinking: { type: 'adaptive' },
      tools: [RECOMMEND_TOOL],
      tool_choice: { type: 'tool', name: 'return_recommendations' },
      messages: [{ role: 'user', content: buildPrompt(favorites, mood) }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) return res.status(500).json({ error: 'Nem sikerült ajánlásokat generálni.' });
    res.json(toolUse.input);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba a Claude API hívásakor: ' + err.message });
  }
});

app.post('/more', async (req, res) => {
  const { favorites, existing, type, mood, ratings } = req.body;
  if (!favorites?.length || !existing?.length || !type) {
    return res.status(400).json({ error: 'Hiányzó paraméterek.' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      tools: [MORE_TOOL],
      tool_choice: { type: 'tool', name: 'return_more' },
      messages: [{ role: 'user', content: buildMorePrompt(favorites, existing, type, mood, ratings) }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) return res.status(500).json({ error: 'Nem sikerült további ajánlásokat generálni.' });
    res.json(toolUse.input);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hiba a Claude API hívásakor: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Könyv/Film Koktél szerver fut: http://localhost:${PORT}`));
