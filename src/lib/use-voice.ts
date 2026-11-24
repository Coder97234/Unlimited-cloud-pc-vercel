import { useEffect, useRef, useState } from 'react';
import { LANGUAGES } from '../../shared/experience.ts';
import type { Language } from '../../shared/experience.ts';

export const voiceSamples: Record<Language, string> = {
  en: 'Hi, I’m Xyvora. What would you like to explore today?',
  es: 'Hola, soy Xyvora. ¿Qué te gustaría explorar hoy?',
  fr: 'Bonjour, je suis Xyvora. Que souhaitez-vous explorer aujourd’hui ?',
  de: 'Hallo, ich bin Xyvora. Was möchtest du heute entdecken?',
  pt: 'Olá, eu sou a Xyvora. O que você gostaria de explorar hoje?',
};

const store = (language: Language) => `xyvora.voice.${language}`;
const saved = (language: Language) => {
  try { return localStorage.getItem(store(language)) ?? ''; } catch { return ''; }
};

export function matchingVoices(voices: SpeechSynthesisVoice[], language: Language) {
  const wanted = LANGUAGES[language].locale.toLowerCase();
  const exact = (voice: SpeechSynthesisVoice) => Number(voice.lang.toLowerCase().replace('_', '-') === wanted);
  return voices.filter((voice) => voice.localService === true && voice.lang.split(/[-_]/)[0].toLowerCase() === language)
    .sort((a, b) => exact(b) - exact(a) || Number(b.default) - Number(a.default) || a.name.localeCompare(b.name));
}

export function speechChunks(markdown: string, locale: string) {
  let fence: string | undefined;
  const prose = markdown.split(/\r?\n/).filter((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return false;
    }
    if (marker) { fence = marker[1]; return false; }
    return true;
  }).join('\n');
  const text = prose
    .replace(/!?\[([^\]\n]*)\]\([^\n)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/g, ' ').replace(/\[\d{1,3}\]/g, ' ')
    .replace(/^\s*[-|:]+\s*$/gm, ' ').replace(/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*$/gm, ' ')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, '').replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ').replace(/ +([,.])/g, '$1').trim().slice(0, 12_000);
  const sentences = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text), ({ segment }) => segment.trim())
    : text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  for (let sentence of sentences) {
    while (sentence.length > 220) {
      const space = sentence.lastIndexOf(' ', 220);
      const end = space > 30 ? space : 220;
      chunks.push(sentence.slice(0, end));
      sentence = sentence.slice(end).trimStart();
    }
    if (!sentence) continue;
    const previous = chunks.at(-1);
    if (previous && previous.length + 1 + sentence.length <= 220) chunks[chunks.length - 1] += ` ${sentence}`;
    else chunks.push(sentence);
  }
  return chunks;
}

type SpeechOutcome = 'started' | 'missing' | 'empty' | 'failed';
export function useVoice(language: Language) {
  const synth = typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : undefined;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState<string>();
  const [favorite, setFavorite] = useState('');
  const job = useRef<{ id: string; utterance?: SpeechSynthesisUtterance } | undefined>(undefined);
  useEffect(() => {
    if (!synth) return;
    const refresh = () => setVoices(synth.getVoices());
    refresh(); synth.addEventListener('voiceschanged', refresh);
    return () => { synth.removeEventListener('voiceschanged', refresh); if (job.current) { job.current = undefined; synth.cancel(); } };
  }, [synth]);
  useEffect(() => { setFavorite(saved(language)); }, [language]);
  function stop() {
    if (!job.current) return;
    job.current = undefined;
    synth?.cancel(); setSpeaking(undefined);
  }
  function select(uri: string) {
    if (uri && !matchingVoices(voices, language).some((voice) => voice.voiceURI === uri)) return;
    setFavorite(uri);
    try { if (uri) localStorage.setItem(store(language), uri); else localStorage.removeItem(store(language)); } catch { /* Device storage is optional. */ }
  }
  function speak(id: string, text: string, inLanguage: Language, onError: () => void): SpeechOutcome {
    if (!synth) return 'missing';
    const list = matchingVoices(synth.getVoices(), inLanguage);
    const uri = inLanguage === language ? favorite : saved(inLanguage);
    const voice = list.find((item) => item.voiceURI === uri) ?? list[0];
    if (!voice) return 'missing';
    const chunks = speechChunks(text, voice.lang);
    if (!chunks.length) return 'empty';
    stop();
    const operation: NonNullable<typeof job.current> = { id };
    job.current = operation;
    let next = 0;
    function advance() {
      if (job.current !== operation) return;
      if (!synth || next === chunks.length) { job.current = undefined; setSpeaking(undefined); return; }
      const utterance = operation.utterance = new SpeechSynthesisUtterance(chunks[next++]);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = .94;
      utterance.onend = () => { try { advance(); } catch { stop(); onError(); } };
      utterance.onerror = () => { if (job.current === operation) { stop(); onError(); } };
      synth.speak(utterance);
    }
    try { setSpeaking(id); advance(); return 'started'; }
    catch { stop(); return 'failed'; }
  }
  const choices = matchingVoices(voices, language);
  return { supported: !!synth, choices, favorite: choices.some(({ voiceURI }) => voiceURI === favorite) ? favorite : '', select, speaking, speak, stop };
}
export type VoiceControls = ReturnType<typeof useVoice>;
