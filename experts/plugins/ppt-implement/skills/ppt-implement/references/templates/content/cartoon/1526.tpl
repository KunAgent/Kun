<!-- Template: 卡通风格-变体6 (Content #1530) - 游戏界面布局 -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-b from-sky-300 via-sky-200 to-green-200">
        
        
        <!-- 云朵装饰 -->
        <div class="absolute top-16 left-40 text-8xl opacity-60">☁️</div>
        <div class="absolute top-28 right-56 text-7xl opacity-50">☁️</div>
        <div class="absolute top-48 left-[60%] text-6xl opacity-40">☁️</div>
        
        <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col gap-8">
            <!-- 游戏标题栏 -->
            <div class="bg-gradient-to-r from-indigo-500 to-purple-500 rounded-3xl p-7 shadow-2xl flex items-center justify-between">
                <div class="flex items-center gap-5">
                    <div class="w-20 h-20 bg-yellow-400 rounded-full flex items-center justify-center text-4xl shadow-lg">😎</div>
                    <div>
                        <h1 class="text-4xl font-black text-white">学习大冒险</h1>
                        <p class="text-indigo-200 text-lg font-bold">Level 5 - 知识岛探索</p>
                    </div>
                </div>
                <div class="flex gap-7">
                    <div class="bg-white/20 backdrop-blur rounded-2xl px-7 py-4">
                        <p class="text-yellow-300 text-base font-bold">⭐ 积分</p>
                        <p class="text-white text-3xl font-black">2,480</p>
                    </div>
                    <div class="bg-white/20 backdrop-blur rounded-2xl px-7 py-4">
                        <p class="text-red-300 text-base font-bold">❤️ 生命</p>
                        <p class="text-white text-3xl font-black">3 / 5</p>
                    </div>
                </div>
            </div>
            
            <!-- 关卡地图 -->
            <div class="flex-1 relative">
                <svg class="absolute inset-0 w-full h-full" style="z-index: 1;">
                    <path d="M 170 400 Q 340 200, 510 300 T 850 250 T 1190 350" stroke="#8B5CF6" stroke-width="14" fill="none" stroke-dasharray="22,11" opacity="0.5"/>
                </svg>
                
                <div class="relative z-10 h-full">
                    <!-- 关卡1 -->
                    <div class="absolute left-40 top-[280px] transform -translate-x-1/2 -translate-y-1/2">
                        <div class="bg-green-400 w-36 h-36 rounded-full shadow-2xl flex flex-col items-center justify-center cursor-pointer hover:scale-110 transition-transform relative">
                            <div class="absolute -top-9 bg-green-600 text-white px-5 py-2 rounded-full font-bold text-base">已完成</div>
                            <div class="text-6xl mb-2">✅</div>
                            <p class="text-white font-bold text-base">第1关</p>
                        </div>
                    </div>
                    
                    <!-- 关卡2 -->
                    <div class="absolute left-[320px] top-[120px] transform -translate-x-1/2 -translate-y-1/2">
                        <div class="bg-blue-400 w-36 h-36 rounded-full shadow-2xl flex flex-col items-center justify-center cursor-pointer hover:scale-110 transition-transform relative">
                            <div class="absolute -top-9 bg-blue-600 text-white px-5 py-2 rounded-full font-bold text-base">已完成</div>
                            <div class="text-6xl mb-2">✅</div>
                            <p class="text-white font-bold text-base">第2关</p>
                        </div>
                    </div>
                    
                    <!-- 关卡3 - 当前 -->
                    <div class="absolute left-[490px] top-[200px] transform -translate-x-1/2 -translate-y-1/2">
                        <div class="bg-yellow-400 w-44 h-44 rounded-full shadow-2xl flex flex-col items-center justify-center cursor-pointer animate-bounce relative">
                            <div class="absolute -top-12 bg-red-500 text-white px-6 py-3 rounded-full font-bold text-lg">正在挑战</div>
                            <div class="text-7xl mb-3">🎯</div>
                            <p class="text-gray-800 font-black text-xl">第3关</p>
                        </div>
                    </div>
                    
                    <!-- 关卡4 -->
                    <div class="absolute left-[690px] top-[160px] transform -translate-x-1/2 -translate-y-1/2">
                        <div class="bg-gray-300 w-36 h-36 rounded-full shadow-xl flex flex-col items-center justify-center relative opacity-60">
                            <div class="absolute -top-7 text-5xl">🔒</div>
                            <div class="text-6xl mb-2">❓</div>
                            <p class="text-gray-600 font-bold text-base">第4关</p>
                        </div>
                    </div>
                    
                    <!-- 关卡5 - Boss -->
                    <div class="absolute left-[1020px] top-[240px] transform -translate-x-1/2 -translate-y-1/2">
                        <div class="bg-purple-500 w-48 h-48 rounded-full shadow-2xl flex flex-col items-center justify-center relative opacity-60">
                            <div class="absolute -top-12 bg-purple-700 text-white px-6 py-3 rounded-full font-bold text-lg">Boss关卡</div>
                            <div class="absolute -top-7 text-5xl">🔒</div>
                            <div class="text-8xl mb-3">👾</div>
                            <p class="text-white font-black text-xl">最终Boss</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 任务提示 -->
            <div class="bg-white/90 backdrop-blur rounded-2xl p-6 shadow-xl flex items-center gap-5">
                <div class="text-6xl">📢</div>
                <div class="flex-1">
                    <h3 class="text-2xl font-bold text-gray-800 mb-2">当前任务：完成数据结构练习</h3>
                    <p class="text-gray-600 text-lg">完成3道算法题即可解锁下一关！加油！💪</p>
                </div>
                <button class="bg-gradient-to-r from-green-400 to-emerald-500 text-white px-9 py-5 rounded-2xl font-bold text-xl shadow-lg hover:scale-105 transition-transform">
                    开始挑战 →
                </button>
            </div>
        </div>
    </div>
