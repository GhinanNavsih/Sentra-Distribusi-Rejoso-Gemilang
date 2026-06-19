import React, { useState } from 'react';
import { getEnvMode, setEnvMode } from '../utils/envMode';

export default function EnvToggle() {
    const [mode, setMode] = useState(getEnvMode);

    const handleToggle = () => {
        const newMode = mode === 'production' ? 'staging' : 'production';
        setEnvMode(newMode);
        setMode(newMode);
        // Reload the page so all services pick up the new collection names
        window.location.reload();
    };

    const isStaging = mode === 'staging';

    return (
        <button
            onClick={handleToggle}
            className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 cursor-pointer ${
                isStaging
                    ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
            }`}
            title={`Currently: ${isStaging ? 'STAGING' : 'PRODUCTION'} — Click to switch`}
        >
            <span className={`inline-block w-2 h-2 rounded-full ${isStaging ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            <span className="hidden sm:inline">{isStaging ? 'STAGING' : 'PRODUCTION'}</span>
            <span className="inline sm:hidden">{isStaging ? 'STAG' : 'PROD'}</span>
        </button>
    );
}
