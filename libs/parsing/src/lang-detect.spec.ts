import { detectLang } from './lang-detect';

describe('detectLang', () => {
  it('detects Hebrew text', () => {
    expect(detectLang('זהו מסמך בעברית עם מספר מילים כדי לבדוק את הזיהוי.')).toBe('he');
  });

  it('detects English text', () => {
    expect(detectLang('This is an English document with several words to test detection.')).toBe('en');
  });

  it('detects mixed Hebrew/English text', () => {
    expect(detectLang('פרוטוקול ישיבה — Board Meeting Minutes, תאריך 2026-08-28, agenda items follow')).toBe('mixed');
  });

  it('defaults to en for text with no alphabetic signal (numbers/punctuation only)', () => {
    expect(detectLang('12345 - 67890 / 00:00')).toBe('en');
  });
});
