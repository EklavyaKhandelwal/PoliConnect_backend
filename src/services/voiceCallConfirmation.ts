const AFFIRMATIVE_PREFIX =
  /^(?:(?:okay|ok|alright|all right|fine|of course|please)[\s,]+)*(?:yes|yeah|yep|yup|sure|absolutely|definitely|correct|right|that'?s right|that is right|i confirm|i agree|go ahead|proceed|do it|please do|submit(?: it| this| my complaint)?|file it|haan(?: ji)?|han(?: ji)?|हाँ(?: जी| सही है| जमा करें| दर्ज करें| कर दीजिए| कर दो)?|हां(?: जी| हां| सही है| जमा करें| दर्ज करें| कर दीजिए| कर दो)?|जी(?: हाँ| हां)?|ठीक है|ठीक आहे|कर दीजिए|कर दो|दर्ज करें|हो(?:य)?|होय|हो नोंदवा|बरोबर|नोंदवा|करा)(?=$|[\s.,!?;:])/iu;

const NEGATIVE_OR_CORRECTION =
  /\b(?:no|nope|not|don't|dont|do not|stop|cancel|wait|change|instead|later|maybe|not yet)\b|नहीं|नही|मत|रुकिए|बदल|नको|नाही|थांबा/iu;

export const isAffirmativeVoiceConfirmation = (transcript: string) => {
  const normalized = transcript
    .normalize("NFKC")
    .trim()
    .replace(/[.!?,;:]+/gu, " ")
    .replace(/\s+/gu, " ");
  return Boolean(normalized) &&
    !NEGATIVE_OR_CORRECTION.test(normalized) &&
    AFFIRMATIVE_PREFIX.test(normalized);
};
