const countWords = (text: string) => {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 32) {
      inWord = false;
    } else if (!inWord) {
      n++;
      inWord = true;
    }
  }
  return n;
};

export const countText = (text: string) => ({
  chars: text.length,
  words: countWords(text),
});
