<!-- Template: 扁平风格-变体8 (Content #1568) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-yellow-400 via-orange-400 to-orange-500">
        <!-- 交互状态演示布局 -->
        <div class="w-[1350px] h-[720px] mx-auto my-[20px]">
            <div class="w-full h-full p-12 flex flex-col">
                <h2 class="text-[42px] font-bold text-white mb-4 text-center drop-shadow-lg">微交互</h2>
                <p class="text-[22px] text-white/90 text-center mb-8">Micro-interactions</p>
                
                <!-- 交互演示网格 -->
                <div class="flex-1 max-w-6xl mx-auto grid grid-cols-3 gap-6">
                    <!-- 按钮交互 -->
                    <div class="bg-white rounded-3xl p-6 shadow-2xl">
                        <h3 class="text-[22px] font-bold text-gray-900 mb-5 text-center">细腻</h3>
                        <div class="space-y-3">
                            <div class="relative">
                                <div class="bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold py-3 px-6 rounded-xl text-center text-[16px] shadow-lg transform hover:scale-105 transition-transform cursor-pointer">
                                    Normal
                                </div>
                            </div>
                            <div class="relative">
                                <div class="bg-gradient-to-r from-orange-600 to-orange-700 text-white font-bold py-3 px-6 rounded-xl text-center text-[16px] shadow-xl transform scale-105">
                                    Hover
                                </div>
                                <div class="absolute -top-2 -right-2 w-6 h-6 bg-yellow-400 rounded-full animate-ping"></div>
                            </div>
                            <div class="relative">
                                <div class="bg-gradient-to-r from-orange-700 to-orange-800 text-white font-bold py-3 px-6 rounded-xl text-center text-[16px] shadow-inner transform scale-95">
                                    Active
                                </div>
                            </div>
                        </div>
                        <p class="text-gray-600 text-[14px] mt-5 text-center">注重细节体验</p>
                    </div>
                    
                    <!-- 加载动画 -->
                    <div class="bg-white rounded-3xl p-6 shadow-2xl flex flex-col items-center justify-center">
                        <h3 class="text-[22px] font-bold text-gray-900 mb-6">即时</h3>
                        <div class="relative w-40 h-40 mb-5">
                            <!-- 进度环 -->
                            <svg class="w-full h-full transform -rotate-90">
                                <circle cx="80" cy="80" r="72" stroke="#f3f4f6" stroke-width="14" fill="none"/>
                                <circle cx="80" cy="80" r="72" stroke="url(#gradient)" stroke-width="14" fill="none"
                                        stroke-dasharray="452" stroke-dashoffset="113"
                                        class="transition-all duration-1000"/>
                                <defs>
                                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" style="stop-color:#f59e0b"/>
                                        <stop offset="100%" style="stop-color:#f97316"/>
                                    </linearGradient>
                                </defs>
                            </svg>
                            <div class="absolute inset-0 flex items-center justify-center">
                                <div class="text-center">
                                    <div class="text-[38px] font-bold text-orange-600">75%</div>
                                    <div class="text-[14px] text-gray-500 mt-1">Loading</div>
                                </div>
                            </div>
                        </div>
                        <p class="text-gray-600 text-[14px] text-center">反馈及时有效</p>
                    </div>
                    
                    <!-- 开关切换 -->
                    <div class="bg-white rounded-3xl p-6 shadow-2xl">
                        <h3 class="text-[22px] font-bold text-gray-900 mb-5 text-center">愉悦</h3>
                        <div class="space-y-6">
                            <!-- Toggle开关 -->
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700 font-semibold text-[16px]">通知</span>
                                <div class="relative w-14 h-7 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full shadow-inner cursor-pointer">
                                    <div class="absolute right-1 top-1 w-5 h-5 bg-white rounded-full shadow-lg transition-all"></div>
                                </div>
                            </div>
                            
                            <!-- 滑块 -->
                            <div>
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-gray-700 font-semibold text-[16px]">音量</span>
                                    <span class="text-orange-600 font-bold text-[18px]">80%</span>
                                </div>
                                <div class="relative h-2.5 bg-gray-200 rounded-full overflow-hidden">
                                    <div class="absolute left-0 top-0 bottom-0 w-[80%] bg-gradient-to-r from-orange-500 to-orange-600 rounded-full"></div>
                                    <div class="absolute left-[80%] top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full shadow-lg border-2 border-orange-500"></div>
                                </div>
                            </div>
                            
                            <!-- 复选框 -->
                            <div class="space-y-3">
                                <div class="flex items-center space-x-3">
                                    <div class="w-7 h-7 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow">
                                        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                                        </svg>
                                    </div>
                                    <span class="text-gray-700 text-[16px]">设计优先</span>
                                </div>
                                <div class="flex items-center space-x-3">
                                    <div class="w-7 h-7 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow">
                                        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                                        </svg>
                                    </div>
                                    <span class="text-gray-700 text-[16px]">用户体验</span>
                                </div>
                            </div>
                        </div>
                        <p class="text-gray-600 text-[14px] mt-5 text-center">提升使用满意</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
