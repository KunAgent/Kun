<!-- Template: 几何风格-变体7 (Content #1547) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900">
        <!-- 内容区域 -->
        <div class="w-[1350px] h-[720px] mx-auto my-[20px] flex flex-col items-center justify-center">
            <h2 class="text-[40px] font-bold text-white mb-3 text-center">螺旋演进</h2>
            <p class="text-[20px] text-gray-300 text-center mb-4">从起点到终点的渐进式发展路径</p>
            
            <!-- 螺旋路径布局 -->
            <div class="relative" style="width: 1150px; height: 520px;">
                <!-- 螺旋背景线条 - 从中心向外顺时针展开 -->
                <svg class="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 1150 520">
                    <path d="M 575 280
                             Q 650 280 690 220
                             Q 730 160 820 130
                             Q 920 95 1000 160
                             Q 1080 230 1070 330
                             Q 1060 430 960 480
                             Q 850 530 720 500
                             Q 590 470 480 400
                             Q 350 320 300 220
                             Q 250 120 320 60
                             Q 400 0 520 20" 
                          stroke="#6366f1" stroke-width="4" fill="none" stroke-dasharray="12,6"/>
                </svg>
                
                <!-- 起点 - 中心 -->
                <div class="absolute" style="left: 519px; top: 224px;">
                    <div class="w-28 h-28 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-2xl border-4 border-white">
                        <div class="text-center text-white">
                            <div class="text-[26px] font-bold">起点</div>
                            <div class="text-[14px]">Start</div>
                        </div>
                    </div>
                </div>
                
                <!-- Step 1 - 右上方向 -->
                <div class="absolute" style="left: 640px; top: 155px;">
                    <div class="w-26 h-26 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-xl transform rotate-12" style="width: 104px; height: 104px;">
                        <div class="text-center text-white transform -rotate-12">
                            <div class="text-[18px] font-bold">Step 1</div>
                            <div class="text-[13px]">探索</div>
                        </div>
                    </div>
                </div>
                
                <!-- Step 2 - 右上角 -->
                <div class="absolute" style="left: 780px; top: 65px;">
                    <div class="w-28 h-28 rounded-full bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center shadow-xl">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">Step 2</div>
                            <div class="text-[13px]">研究</div>
                        </div>
                    </div>
                </div>
                
                <!-- Step 3 - 右侧 -->
                <div class="absolute" style="left: 960px; top: 180px;">
                    <div class="w-28 h-28 bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center shadow-xl"
                         style="clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%);">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">Step 3</div>
                            <div class="text-[13px]">开发</div>
                        </div>
                    </div>
                </div>
                
                <!-- Step 4 - 右下 -->
                <div class="absolute" style="left: 880px; top: 370px;">
                    <div class="w-28 h-28 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-xl transform rotate-45">
                        <div class="text-center text-white transform -rotate-45">
                            <div class="text-[18px] font-bold">Step 4</div>
                            <div class="text-[13px]">测试</div>
                        </div>
                    </div>
                </div>
                
                <!-- Step 5 - 下方偏左 -->
                <div class="absolute" style="left: 550px; top: 390px;">
                    <div class="w-32 h-32 rounded-full bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-xl">
                        <div class="text-center text-white">
                            <div class="text-[20px] font-bold">Step 5</div>
                            <div class="text-[13px]">部署</div>
                        </div>
                    </div>
                </div>
                
                <!-- Step 6 - 左侧 -->
                <div class="absolute" style="left: 235px; top: 150px;">
                    <div class="w-28 h-28 bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center shadow-xl"
                         style="clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">Step 6</div>
                            <div class="text-[13px]">监控</div>
                        </div>
                    </div>
                </div>
                
                <!-- 终点 - 顶部偏左 -->
                <div class="absolute" style="left: 455px; top: 0px;">
                    <div class="w-32 h-32 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-indigo-600 flex items-center justify-center shadow-2xl border-4 border-white">
                        <div class="text-center text-white">
                            <div class="text-[22px] font-bold mb-1">终点</div>
                            <div class="text-[14px]">Success</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
