export default function HowToUse() {
    const steps = [
        {
            number: "01",
            title: "Install Extension",
            description: "One click to transform your browser into an intelligent workspace.",
            icon: "⚡",
            gradient: "from-cyan-500 to-blue-600"
        },
        {
            number: "02",
            title: "Pin & Access",
            description: "Keep CoolDesk at your fingertips for instant productivity.",
            icon: "📌",
            gradient: "from-blue-600 to-purple-600"
        },
        {
            number: "03",
            title: "Experience Magic",
            description: "Watch AI organize your digital life automatically.",
            icon: "✨",
            gradient: "from-purple-600 to-pink-600"
        }
    ];

    const features = [
        {
            title: "Smart Workspaces",
            description: "AI-powered tab organization with real-time analytics and insights.",
            icon: "🎯",
            gradient: "from-cyan-500/20 to-blue-600/20",
            borderGradient: "from-cyan-500/50 to-blue-600/50"
        },
        {
            title: "Team Sync",
            description: "Seamless collaboration with instant workspace sharing.",
            icon: "👥",
            gradient: "from-blue-500/20 to-indigo-600/20",
            borderGradient: "from-blue-500/50 to-indigo-600/50"
        },
        {
            title: "Context Notes",
            description: "Intelligent sticky notes that remember where you left off.",
            icon: "📝",
            gradient: "from-purple-500/20 to-pink-600/20",
            borderGradient: "from-purple-500/50 to-pink-600/50"
        },
        {
            title: "AI Chat Hub",
            description: "Auto-categorize conversations across platforms with ML.",
            icon: "🤖",
            gradient: "from-pink-500/20 to-rose-600/20",
            borderGradient: "from-pink-500/50 to-rose-600/50"
        },
        {
            title: "Voice Control",
            description: "Navigate hands-free with natural language commands.",
            icon: "🎤",
            gradient: "from-orange-500/20 to-amber-600/20",
            borderGradient: "from-orange-500/50 to-amber-600/50"
        },
        {
            title: "Command Palette",
            description: "Lightning-fast access to every feature, every workspace.",
            icon: "⌘",
            gradient: "from-emerald-500/20 to-teal-600/20",
            borderGradient: "from-emerald-500/50 to-teal-600/50"
        }
    ];

    return (
        <section id="how-to-use" className="relative py-32 bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 overflow-hidden">
            {/* Advanced Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {/* Animated Gradient Orbs */}
                <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-br from-blue-600/20 via-purple-600/10 to-transparent blur-[120px] rounded-full animate-pulse" />
                <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-gradient-to-tl from-cyan-500/15 via-blue-500/10 to-transparent blur-[100px] rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-gradient-to-r from-purple-600/5 via-pink-600/5 to-blue-600/5 blur-[150px] rounded-full" />

                {/* Grid Pattern Overlay */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,black,transparent)]" />
            </div>

            <div className="container mx-auto px-6 relative z-10">

                {/* Hero Header with Animated Gradient */}
                <div className="text-center mb-24 relative">
                    <div className="inline-block mb-6">
                        <div className="px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 border border-white/10 backdrop-blur-xl">
                            <span className="text-sm font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                                GETTING STARTED
                            </span>
                        </div>
                    </div>
                    <h2 className="text-5xl md:text-7xl font-black text-white mb-6 leading-tight">
                        From Zero to{' '}
                        <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent animate-gradient">
                            Superhuman
                        </span>
                        <br />
                        <span className="text-4xl md:text-5xl text-zinc-400 font-light">in 30 seconds</span>
                    </h2>
                    <p className="text-zinc-400 text-lg max-w-2xl mx-auto leading-relaxed">
                        No setup complexity. No learning curve. No credit card.
                        <br />
                        <span className="text-white font-semibold">Just pure, intelligent productivity.</span>
                    </p>
                </div>

                {/* Premium 3-Step Process with Animated Connections */}
                <div className="max-w-7xl mx-auto mb-32 relative">
                    {/* Animated Connection Line */}
                    <div className="hidden lg:block absolute top-24 left-[12%] right-[12%] h-0.5 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent">
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 animate-shimmer" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative">
                        {steps.map((step, index) => (
                            <div key={index} className="relative group">
                                {/* Floating Card */}
                                <div className="relative bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 backdrop-blur-2xl border border-white/10 rounded-3xl p-10 hover:border-white/20 transition-all duration-500 hover:scale-105 hover:-translate-y-2 shadow-2xl hover:shadow-blue-500/20">
                                    {/* Gradient Overlay on Hover */}
                                    <div className={`absolute inset-0 bg-gradient-to-br ${step.gradient} opacity-0 group-hover:opacity-10 rounded-3xl transition-opacity duration-500`} />

                                    {/* Step Number with Glow */}
                                    <div className="relative mb-8">
                                        <div className="text-8xl font-black text-transparent bg-gradient-to-br from-zinc-800 to-zinc-900 bg-clip-text group-hover:from-blue-500/30 group-hover:to-purple-500/30 transition-all duration-500">
                                            {step.number}
                                        </div>
                                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-6xl group-hover:scale-125 transition-transform duration-500">
                                            {step.icon}
                                        </div>
                                    </div>

                                    <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-cyan-400 group-hover:to-blue-500 group-hover:bg-clip-text transition-all duration-300">
                                        {step.title}
                                    </h3>
                                    <p className="text-zinc-400 leading-relaxed">
                                        {step.description}
                                    </p>

                                    {/* Animated Border Glow */}
                                    <div className={`absolute inset-0 rounded-3xl bg-gradient-to-r ${step.gradient} opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500 -z-10`} />
                                </div>

                                {/* Connection Dot */}
                                <div className="hidden lg:block absolute top-24 left-1/2 -translate-x-1/2 w-4 h-4 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-full border-4 border-zinc-950 group-hover:scale-150 group-hover:shadow-lg group-hover:shadow-blue-500/50 transition-all duration-300 z-10" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Features Showcase - Bento Grid Style */}
                <div className="max-w-7xl mx-auto mb-32">
                    <div className="text-center mb-16">
                        <h3 className="text-4xl md:text-5xl font-black text-white mb-6">
                            <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent">
                                Six Superpowers.
                            </span>
                            <br />
                            One Extension.
                        </h3>
                        <p className="text-zinc-400 text-lg max-w-3xl mx-auto">
                            Every feature designed to eliminate friction and amplify your focus.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {features.map((feature, index) => (
                            <div key={index}
                                className="group relative bg-gradient-to-br from-zinc-900/50 to-zinc-950/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8 hover:border-white/20 transition-all duration-500 hover:scale-105 overflow-hidden">

                                {/* Animated Background Gradient */}
                                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                                {/* Border Gradient Glow */}
                                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.borderGradient} opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500 -z-10`} />

                                <div className="relative z-10">
                                    {/* Icon with Glow Effect */}
                                    <div className="mb-6 relative inline-block">
                                        <div className="text-5xl group-hover:scale-125 transition-transform duration-500">
                                            {feature.icon}
                                        </div>
                                        <div className={`absolute inset-0 bg-gradient-to-br ${feature.borderGradient} blur-2xl opacity-0 group-hover:opacity-60 transition-opacity duration-500`} />
                                    </div>

                                    <h4 className="text-xl font-bold text-white mb-3 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-zinc-300 group-hover:bg-clip-text transition-all duration-300">
                                        {feature.title}
                                    </h4>
                                    <p className="text-zinc-400 leading-relaxed group-hover:text-zinc-300 transition-colors duration-300">
                                        {feature.description}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Premium Login CTA Section */}
                <div className="max-w-6xl mx-auto mb-24">
                    <div className="relative bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden">
                        {/* Animated Background */}
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10 animate-gradient" />
                        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-blue-500/20 to-purple-500/20 blur-[120px] rounded-full" />

                        <div className="relative z-10 grid md:grid-cols-2 gap-12 p-12 items-center">
                            {/* Left: Content */}
                            <div>
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 mb-6">
                                    <span className="text-2xl">🚀</span>
                                    <span className="text-sm font-bold text-blue-400 uppercase tracking-wider">Power User Mode</span>
                                </div>

                                <h3 className="text-3xl md:text-4xl font-black text-white mb-4">
                                    Unlock the Full
                                    <br />
                                    <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent">
                                        AI Experience
                                    </span>
                                </h3>

                                <p className="text-zinc-300 text-lg leading-relaxed mb-8">
                                    CoolDesk works beautifully offline. But sign in to unlock{' '}
                                    <span className="text-white font-semibold">AI-powered categorization</span>,{' '}
                                    <span className="text-white font-semibold">team collaboration</span>,{' '}
                                    <span className="text-white font-semibold">voice commands</span>, and{' '}
                                    <span className="text-white font-semibold">cross-device sync</span>.
                                </p>

                                {/* Feature Comparison */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-4 p-4 rounded-xl bg-zinc-950/50 border border-white/5">
                                        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500 text-sm flex-shrink-0">✕</div>
                                        <span className="text-zinc-400">Guest Mode: Local workspaces & basic notes</span>
                                    </div>
                                    <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-lg shadow-blue-500/50">✓</div>
                                        <span className="text-white font-semibold">
                                            Pro Mode: <span className="text-transparent bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text">Full AI suite</span> + Team sync
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Mock UI */}
                            <div className="relative">
                                <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-8 shadow-2xl transform hover:scale-105 transition-transform duration-500">
                                    {/* Header */}
                                    <div className="flex items-center justify-between mb-6 pb-6 border-b border-zinc-800">
                                        <span className="text-xs font-bold text-zinc-500 tracking-widest">AUTHENTICATION</span>
                                        <div className="flex gap-2">
                                            <div className="w-3 h-3 rounded-full bg-red-500/50" />
                                            <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                                            <div className="w-3 h-3 rounded-full bg-green-500/50" />
                                        </div>
                                    </div>

                                    {/* Google Sign In Button */}
                                    <button className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/50 mb-4 group">
                                        <svg className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                        </svg>
                                        <span>Continue with Google</span>
                                    </button>

                                    <div className="text-center">
                                        <span className="text-xs text-zinc-600 uppercase tracking-widest">or continue as guest</span>
                                    </div>
                                </div>

                                {/* Floating Badges */}
                                <div className="absolute -top-4 -right-4 px-3 py-1 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 text-white text-xs font-bold shadow-lg animate-bounce">
                                    Free Forever
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Final CTA with Premium Styling */}
                <div className="text-center">
                    <a href="https://chromewebstore.google.com/detail/cooldesk/ioggffobciopdddacpclplkeodllhjko"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-3 bg-gradient-to-r from-cyan-500 via-blue-600 to-purple-600 text-white px-10 py-5 rounded-2xl font-bold text-lg hover:shadow-2xl hover:shadow-blue-500/50 transition-all duration-500 hover:scale-110 active:scale-95 relative overflow-hidden">

                        {/* Animated Shine Effect */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />

                        <span className="relative z-10">Add to Chrome — It's Free</span>
                        <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </a>

                    <div className="mt-6 flex items-center justify-center gap-6 text-zinc-500 text-sm">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span>100% Free</span>
                        </div>
                        <div className="w-1 h-1 rounded-full bg-zinc-700" />
                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                            <span>Privacy First</span>
                        </div>
                        <div className="w-1 h-1 rounded-full bg-zinc-700" />
                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>Instant Setup</span>
                        </div>
                    </div>
                </div>

            </div>

            <style jsx>{`
                @keyframes gradient {
                    0%, 100% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                }
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .animate-gradient {
                    background-size: 200% 200%;
                    animation: gradient 3s ease infinite;
                }
                .animate-shimmer {
                    animation: shimmer 2s ease-in-out infinite;
                }
            `}</style>
        </section>
    );
}