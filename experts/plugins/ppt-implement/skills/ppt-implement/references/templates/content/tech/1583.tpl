<!-- Template: 科技风格-变体3 (Content #1575) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-black">
        
        <!-- 电路板背景 -->
        <svg class="absolute inset-0 w-full h-full opacity-20" viewBox="0 0 1280 720">
            <!-- 水平线路 -->
            <line x1="0" y1="100" x2="400" y2="100" stroke="#00ffff" stroke-width="2"/>
            <line x1="500" y1="100" x2="800" y2="100" stroke="#00ffff" stroke-width="2"/>
            <line x1="900" y1="100" x2="1280" y2="100" stroke="#00ffff" stroke-width="2"/>
            
            <line x1="0" y1="300" x2="300" y2="300" stroke="#0080ff" stroke-width="2"/>
            <line x1="450" y1="300" x2="850" y2="300" stroke="#0080ff" stroke-width="2"/>
            <line x1="950" y1="300" x2="1280" y2="300" stroke="#0080ff" stroke-width="2"/>
            
            <line x1="0" y1="500" x2="500" y2="500" stroke="#00ffff" stroke-width="2"/>
            <line x1="600" y1="500" x2="900" y2="500" stroke="#00ffff" stroke-width="2"/>
            <line x1="1000" y1="500" x2="1280" y2="500" stroke="#00ffff" stroke-width="2"/>
            
            <!-- 垂直线路 -->
            <line x1="200" y1="0" x2="200" y2="250" stroke="#00ffff" stroke-width="2"/>
            <line x1="200" y1="350" x2="200" y2="720" stroke="#00ffff" stroke-width="2"/>
            
            <line x1="500" y1="0" x2="500" y2="200" stroke="#0080ff" stroke-width="2"/>
            <line x1="500" y1="400" x2="500" y2="720" stroke="#0080ff" stroke-width="2"/>
            
            <line x1="800" y1="0" x2="800" y2="300" stroke="#00ffff" stroke-width="2"/>
            <line x1="800" y1="450" x2="800" y2="720" stroke="#00ffff" stroke-width="2"/>
            
            <line x1="1080" y1="0" x2="1080" y2="350" stroke="#0080ff" stroke-width="2"/>
            <line x1="1080" y1="500" x2="1080" y2="720" stroke="#0080ff" stroke-width="2"/>
            
            <!-- 连接点 -->
            <circle cx="200" cy="300" r="6" fill="#00ffff"/>
            <circle cx="500" cy="300" r="6" fill="#0080ff"/>
            <circle cx="800" cy="100" r="6" fill="#00ffff"/>
            <circle cx="800" cy="500" r="6" fill="#00ffff"/>
            <circle cx="1080" cy="300" r="6" fill="#0080ff"/>
        </svg>
        
        <div class="w-full h-full flex items-center justify-center relative">
            <!-- 内容区域 -->
            <div class="w-[1350px] h-[720px] mx-auto my-[20px] p-12 flex items-center justify-center relative">
                <!-- 标题 -->
                <h2 class="absolute top-12 left-1/2 transform -translate-x-1/2 text-[42px] font-bold text-cyan-400 mb-4 z-10">
                    智能芯片架构
                </h2>
                
                <!-- 芯片布局 -->
                <div class="relative w-[900px] h-[450px]">
                    <!-- 中央处理器芯片 -->
                    <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-4 border-cyan-400 bg-gradient-to-br from-slate-900 to-blue-900 shadow-2xl"
                         style="box-shadow: 0 0 60px rgba(0,255,255,0.5);">
                        <div class="absolute inset-4 border-2 border-cyan-500/50"></div>
                        <div class="absolute inset-8 border border-cyan-500/30"></div>
                        
                        <!-- 芯片中心 -->
                        <div class="absolute inset-0 flex items-center justify-center">
                            <div class="text-center">
                                <div class="text-[38px] mb-3 text-cyan-400">⚡</div>
                                <p class="text-[30px] font-bold text-white">CPU</p>
                                <p class="text-cyan-400 text-[16px] mt-2">Central Core</p>
                            </div>
                        </div>
                        
                        <!-- 芯片引脚 (左侧) -->
                        <div class="absolute left-0 top-0 bottom-0 flex flex-col justify-around -translate-x-full pr-2">
                            <div class="w-8 h-2 bg-cyan-400"></div>
                            <div class="w-8 h-2 bg-cyan-400"></div>
                            <div class="w-8 h-2 bg-cyan-400"></div>
                            <div class="w-8 h-2 bg-cyan-400"></div>
                        </div>
                        
                        <!-- 芯片引脚 (右侧) -->
                        <div class="absolute right-0 top-0 bottom-0 flex flex-col justify-around translate-x-full pl-2">
                            <div class="w-8 h-2 bg-cyan-400"></div>
                            <div class="w-8 h-2 bg-cyan-400"></div>
                            <div class="w-8 h-2 bg-cyan-400"></div>
                            <div class="w-8 h-2 bg-cyan-400"></div>
                        </div>
                        
                        <!-- 芯片引脚 (顶部) -->
                        <div class="absolute top-0 left-0 right-0 flex justify-around -translate-y-full pb-2">
                            <div class="w-2 h-8 bg-cyan-400"></div>
                            <div class="w-2 h-8 bg-cyan-400"></div>
                            <div class="w-2 h-8 bg-cyan-400"></div>
                            <div class="w-2 h-8 bg-cyan-400"></div>
                        </div>
                        
                        <!-- 芯片引脚 (底部) -->
                        <div class="absolute bottom-0 left-0 right-0 flex justify-around translate-y-full pt-2">
                            <div class="w-2 h-8 bg-cyan-400"></div>
                            <div class="w-2 h-8 bg-cyan-400"></div>
                            <div class="w-2 h-8 bg-cyan-400"></div>
                            <div class="w-2 h-8 bg-cyan-400"></div>
                        </div>
                    </div>
                    
                    <!-- 外围芯片模块 -->
                    <!-- 左上 - GPU -->
                    <div class="absolute top-0 left-0 w-36 h-36 border-2 border-blue-400 bg-slate-800/80 p-4 text-center">
                        <p class="text-blue-400 text-[22px] font-bold mb-2">GPU</p>
                        <p class="text-gray-400 text-[14px]">Graphics</p>
                        <div class="mt-3 text-[30px]">🎮</div>
                    </div>
                    
                    <!-- 右上 - Memory -->
                    <div class="absolute top-0 right-0 w-36 h-36 border-2 border-purple-400 bg-slate-800/80 p-4 text-center">
                        <p class="text-purple-400 text-[22px] font-bold mb-2">RAM</p>
                        <p class="text-gray-400 text-[14px]">Memory</p>
                        <div class="mt-3 text-[30px]">💾</div>
                    </div>
                    
                    <!-- 左下 - Storage -->
                    <div class="absolute bottom-0 left-0 w-36 h-36 border-2 border-green-400 bg-slate-800/80 p-4 text-center">
                        <p class="text-green-400 text-[22px] font-bold mb-2">SSD</p>
                        <p class="text-gray-400 text-[14px]">Storage</p>
                        <div class="mt-3 text-[30px]">💿</div>
                    </div>
                    
                    <!-- 右下 - Network -->
                    <div class="absolute bottom-0 right-0 w-36 h-36 border-2 border-yellow-400 bg-slate-800/80 p-4 text-center">
                        <p class="text-yellow-400 text-[22px] font-bold mb-2">NIC</p>
                        <p class="text-gray-400 text-[14px]">Network</p>
                        <div class="mt-3 text-[30px]">📡</div>
                    </div>
                    
                    <!-- 连接线 -->
                    <svg class="absolute inset-0 w-full h-full pointer-events-none">
                        <line x1="150" y1="150" x2="320" y2="190" stroke="#00ffff" stroke-width="2" stroke-dasharray="5,5"/>
                        <line x1="750" y1="150" x2="580" y2="190" stroke="#00ffff" stroke-width="2" stroke-dasharray="5,5"/>
                        <line x1="150" y1="300" x2="320" y2="260" stroke="#00ffff" stroke-width="2" stroke-dasharray="5,5"/>
                        <line x1="750" y1="300" x2="580" y2="260" stroke="#00ffff" stroke-width="2" stroke-dasharray="5,5"/>
                    </svg>
                </div>
            </div>
        </div>
    </div>
