import { useState } from 'react';
import { LANGUAGES, getLanguagePreference, setLanguage, useT } from './index';

// The language dropdown: "Browser default" plus every supported language in
// its own script. Used by the new tab's Customize panel and the desktop
// app's Settings window; both write the same preference.
export function LanguageSelect({ className, style }) {
    const t = useT();
    const [pref, setPref] = useState(getLanguagePreference);
    return (
        <select
            className={className}
            style={style}
            value={pref}
            aria-label={t('cz.language')}
            onChange={e => { setPref(e.target.value); setLanguage(e.target.value); }}
        >
            <option value="auto">{t('cz.languageAuto')}</option>
            {LANGUAGES.map(l => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
        </select>
    );
}
