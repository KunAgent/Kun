<!-- Template: 卡通风格-变体9 (Content #1533) - 天气预报卡片布局 -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-b from-blue-400 via-cyan-300 to-blue-200">
        
        
        <!-- 太阳 -->
        <div class="absolute top-24 right-40 w-36 h-36 bg-yellow-300 rounded-full shadow-2xl animate-pulse"></div>
        <div class="absolute top-28 right-44 w-28 h-28 bg-yellow-200 rounded-full blur-xl"></div>
        
        <!-- 云朵 -->
        <div class="absolute top-56 left-30">
            <div class="relative">
                <div class="w-28 h-20 bg-white rounded-full shadow-lg"></div>
                <div class="absolute top-2 left-10 w-36 h-24 bg-white rounded-full shadow-lg"></div>
                <div class="absolute top-5 right-5 w-24 h-16 bg-white rounded-full shadow-lg"></div>
            </div>
        </div>
        
        <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col gap-10">
            <!-- 标题卡片 -->
            <div class="bg-white/90 backdrop-blur rounded-3xl p-9 shadow-2xl">
                <div class="flex items-center justify-between">
                    <div>
                        <h1 class="text-6xl font-black text-blue-600 mb-3">本周天气预报 🌤️</h1>
                        <p class="text-2xl text-gray-600 font-semibold">Happy Weather Forecast</p>
                    </div>
                    <div class="text-right">
                        <p class="text-gray-500 text-xl font-medium">2024年1月</p>
                        <p class="text-5xl font-black text-blue-500">15 - 21日</p>
                    </div>
                </div>
            </div>
            
            <!-- 天气卡片网格 -->
            <div class="grid grid-cols-7 gap-5">
                <!-- 周一 -->
                <div class="bg-gradient-to-b from-yellow-300 to-orange-300 rounded-2xl p-6 shadow-xl hover:scale-105 transition-transform">
                    <p class="text-center font-bold text-orange-800 mb-4 text-xl">周一</p>
                    <div class="text-7xl text-center mb-4">☀️</div>
                    <p class="text-center font-black text-orange-900 text-3xl mb-2">28°</p>
                    <p class="text-center text-orange-700 font-semibold text-base">晴天</p>
                </div>
                
                <!-- 周二 -->
                <div class="bg-gradient-to-b from-blue-300 to-blue-400 rounded-2xl p-6 shadow-xl hover:scale-105 transition-transform">
                    <p class="text-center font-bold text-blue-800 mb-4 text-xl">周二</p>
                    <div class="text-7xl text-center mb-4">🌧️</div>
                    <p class="text-center font-black text-blue-900 text-3xl mb-2">22°</p>
                    <p class="text-center text-blue-700 font-semibold text-base">小雨</p>
                </div>
                
                <!-- 周三 -->
                <div class="bg-gradient-to-b from-gray-300 to-gray-400 rounded-2xl p-6 shadow-xl hover:scale-105 transition-transform">
                    <p class="text-center font-bold text-gray-800 mb-4 text-xl">周三</p>
                    <div class="text-7xl text-center mb-4">☁️</div>
                    <p class="text-center font-black text-gray-900 text-3xl mb-2">24°</p>
                    <p class="text-center text-gray-700 font-semibold text-base">多云</p>
                </div>
                
                <!-- 周四 -->
                <div class="bg-gradient-to-b from-cyan-300 to-cyan-400 rounded-2xl p-6 shadow-xl hover:scale-105 transition-transform">
                    <p class="text-center font-bold text-cyan-800 mb-4 text-xl">周四</p>
                    <div class="text-7xl text-center mb-4">⛈️</div>
                    <p class="text-center font-black text-cyan-900 text-3xl mb-2">20°</p>
                    <p class="text-center text-cyan-700 font-semibold text-base">雷阵雨</p>
                </div>
                
                <!-- 周五 -->
                <div class="bg-gradient-to-b from-amber-300 to-yellow-400 rounded-2xl p-6 shadow-xl hover:scale-105 transition-transform">
                    <p class="text-center font-bold text-amber-800 mb-4 text-xl">周五</p>
                    <div class="text-7xl text-center mb-4">🌤️</div>
                    <p class="text-center font-black text-amber-900 text-3xl mb-2">26°</p>
                    <p class="text-center text-amber-700 font-semibold text-base">晴转多云</p>
                </div>
                
                <!-- 周六 -->
                <div class="bg-gradient-to-b from-orange-300 to-red-400 rounded-2xl p-6 shadow-xl hover:scale-105 transition-transform">
                    <p class="text-center font-bold text-orange-800 mb-4 text-xl">周六</p>
                    <div class="text-7xl text-center mb-4">☀️</div>
                    <p class="text-center font-black text-orange-900 text-3xl mb-2">30°</p>
                    <p class="text-center text-orange-700 font-semibold text-base">晴热</p>
                </div>
                
                <!-- 周日 -->
                <div class="bg-gradient-to-b from-pink-300 to-rose-400 rounded-2xl p-6 shadow-xl hover:scale-105 transition-transform">
                    <p class="text-center font-bold text-pink-800 mb-4 text-xl">周日</p>
                    <div class="text-7xl text-center mb-4">🌈</div>
                    <p class="text-center font-black text-pink-900 text-3xl mb-2">27°</p>
                    <p class="text-center text-pink-700 font-semibold text-base">雨后彩虹</p>
                </div>
            </div>
            
            <!-- 温馨提示 -->
            <div class="bg-white/90 backdrop-blur rounded-2xl p-7 shadow-xl flex items-center gap-7">
                <div class="text-7xl">💡</div>
                <div class="flex-1">
                    <h3 class="text-3xl font-bold text-gray-800 mb-3">温馨提示</h3>
                    <p class="text-gray-700 text-xl leading-relaxed">本周气温变化较大，请注意及时增减衣物。周二、周四有降雨，出门记得带伞哦～ 🌂</p>
                </div>
                <div class="flex gap-4">
                    <div class="bg-blue-100 px-5 py-3 rounded-full">
                        <p class="text-blue-700 text-lg font-bold">🌊 湿度 65%</p>
                    </div>
                    <div class="bg-green-100 px-5 py-3 rounded-full">
                        <p class="text-green-700 text-lg font-bold">💨 风力 3级</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
