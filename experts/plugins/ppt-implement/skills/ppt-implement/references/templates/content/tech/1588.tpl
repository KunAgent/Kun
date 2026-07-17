<!-- Template: 科技风格-变体8 (Content #1580) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-indigo-950 via-black to-purple-950">
        
        <!-- 全息网格背景 -->
        <div class="absolute inset-0" style="background: 
            repeating-linear-gradient(0deg, transparent 0px, transparent 19px, rgba(0,255,255,0.05) 19px, rgba(0,255,255,0.05) 20px),
            repeating-linear-gradient(90deg, transparent 0px, transparent 19px, rgba(0,255,255,0.05) 19px, rgba(0,255,255,0.05) 20px),
            radial-gradient(ellipse at center, rgba(0,100,255,0.1) 0%, transparent 70%);">
        </div>
        
        <div class="w-full h-full flex items-center justify-center relative">
            <!-- 内容区域 -->
            <div class="w-[1350px] h-[720px] mx-auto my-[20px] p-12 flex items-center justify-center relative">
                <!-- 标题 -->
                <h2 class="absolute top-12 left-1/2 transform -translate-x-1/2 text-[42px] font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 z-10">
                    全息数据展示
                </h2>
                
                <!-- 全息投影台 -->
                <div class="relative w-full max-w-5xl h-[450px]" style="perspective: 1500px;">
                    <!-- 投影底座 -->
                    <div class="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-[600px] h-8 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent rounded-full blur-sm"></div>
                    <div class="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-[550px] h-4 bg-gradient-to-r from-transparent via-blue-400/30 to-transparent rounded-full"></div>
                    
                    <!-- 全息图形容器 -->
                    <div class="absolute bottom-16 left-1/2 transform -translate-x-1/2" style="transform-style: preserve-3d;">
                        <!-- 中央球体 -->
                        <div class="relative w-64 h-64 mx-auto mb-8">
                        <svg class="w-full h-full animate-spin-slow" viewBox="0 0 200 200" style="animation-duration: 20s;">
                            <!-- 球体外圈 -->
                            <circle cx="100" cy="100" r="90" fill="none" stroke="url(#holoGrad1)" stroke-width="2" opacity="0.6"/>
                            <circle cx="100" cy="100" r="75" fill="none" stroke="url(#holoGrad1)" stroke-width="1.5" opacity="0.5"/>
                            <circle cx="100" cy="100" r="60" fill="none" stroke="url(#holoGrad1)" stroke-width="1.5" opacity="0.4"/>
                            
                            <!-- 经纬线 -->
                            <ellipse cx="100" cy="100" rx="90" ry="30" fill="none" stroke="#00ffff" stroke-width="1" opacity="0.3"/>
                            <ellipse cx="100" cy="100" rx="90" ry="50" fill="none" stroke="#00ffff" stroke-width="1" opacity="0.3"/>
                            <ellipse cx="100" cy="100" rx="30" ry="90" fill="none" stroke="#0080ff" stroke-width="1" opacity="0.3"/>
                            <ellipse cx="100" cy="100" rx="50" ry="90" fill="none" stroke="#0080ff" stroke-width="1" opacity="0.3"/>
                            
                            <!-- 中心光点 -->
                            <circle cx="100" cy="100" r="15" fill="url(#coreGrad)" opacity="0.8"/>
                            <circle cx="100" cy="100" r="8" fill="#00ffff" opacity="1">
                                <animate attributeName="r" values="8;12;8" dur="2s" repeatCount="indefinite"/>
                                <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"/>
                            </circle>
                            
                            <defs>
                                <linearGradient id="holoGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" style="stop-color:#00ffff;stop-opacity:0.8" />
                                    <stop offset="50%" style="stop-color:#0080ff;stop-opacity:1" />
                                    <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:0.8" />
                                </linearGradient>
                                <radialGradient id="coreGrad">
                                    <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
                                    <stop offset="50%" style="stop-color:#00ffff;stop-opacity:0.8" />
                                    <stop offset="100%" style="stop-color:#0080ff;stop-opacity:0.3" />
                                </radialGradient>
                            </defs>
                        </svg>
                        
                            <!-- 垂直光束 -->
                            <div class="absolute top-full left-1/2 transform -translate-x-1/2 w-1 h-24 bg-gradient-to-b from-cyan-400 to-transparent opacity-50"></div>
                        </div>
                        
                        <!-- 围绕的数据面板 -->
                        <!-- 面板1 (左前) -->
                        <div class="absolute -left-64 top-32 w-48 h-32 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-400/50 rounded-lg p-4 backdrop-blur"
                             style="transform: rotateY(25deg);">
                            <p class="text-cyan-400 text-[16px] font-bold mb-2">实时数据流</p>
                            <div class="space-y-1">
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">吞吐量</span>
                                    <span class="text-cyan-300">2.5 GB/s</span>
                                </div>
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">延迟</span>
                                    <span class="text-green-300">3.2 ms</span>
                                </div>
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">连接数</span>
                                    <span class="text-purple-300">12,456</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 面板2 (右前) -->
                        <div class="absolute -right-64 top-32 w-48 h-32 bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-purple-400/50 rounded-lg p-4 backdrop-blur"
                             style="transform: rotateY(-25deg);">
                            <p class="text-purple-400 text-[16px] font-bold mb-2">系统状态</p>
                            <div class="space-y-1">
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">CPU使用率</span>
                                    <span class="text-yellow-300">45%</span>
                                </div>
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">内存占用</span>
                                    <span class="text-cyan-300">8.2 GB</span>
                                </div>
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">在线节点</span>
                                    <span class="text-green-300">256/256</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 面板3 (左后) -->
                        <div class="absolute -left-48 top-0 w-44 h-28 bg-gradient-to-br from-green-500/20 to-emerald-600/20 border border-green-400/50 rounded-lg p-4 backdrop-blur"
                             style="transform: rotateY(45deg) translateZ(-50px);">
                            <p class="text-green-400 text-[16px] font-bold mb-2">安全防护</p>
                            <div class="space-y-1">
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">防御等级</span>
                                    <span class="text-green-300">AAA+</span>
                                </div>
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">拦截攻击</span>
                                    <span class="text-red-300">1,234</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 面板4 (右后) -->
                        <div class="absolute -right-48 top-0 w-44 h-28 bg-gradient-to-br from-yellow-500/20 to-orange-600/20 border border-yellow-400/50 rounded-lg p-4 backdrop-blur"
                             style="transform: rotateY(-45deg) translateZ(-50px);">
                            <p class="text-yellow-400 text-[16px] font-bold mb-2">性能指标</p>
                            <div class="space-y-1">
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">响应时间</span>
                                    <span class="text-cyan-300">45ms</span>
                                </div>
                                <div class="flex justify-between text-[14px]">
                                    <span class="text-gray-400">成功率</span>
                                    <span class="text-green-300">99.99%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- 底部说明 -->
                <div class="absolute bottom-10 left-1/2 transform -translate-x-1/2 text-center">
                    <p class="text-cyan-400 font-mono text-[16px] mb-2">HOLOGRAPHIC DATA VISUALIZATION SYSTEM</p>
                    <p class="text-gray-500 text-[14px]">实时 · 立体 · 交互</p>
                </div>
            </div>
        </div>
        
        <style>
            @keyframes spin-slow {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .animate-spin-slow {
                animation: spin-slow 20s linear infinite;
            }
        </style>
    </div>
