<!-- Template: 黑金风格-变体5 (Content #1575) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-black">
        <!-- 仪表盘背景纹理 -->
        <div class="absolute inset-0" style="background: 
            radial-gradient(circle at 50% 50%, rgba(255,215,0,0.1) 0%, transparent 50%),
            repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,215,0,0.03) 2px, rgba(255,215,0,0.03) 4px);">
        </div>
        
        <!-- 内容区域包装 -->
        <div class="w-[1350px] h-[720px] mx-auto my-[20px] relative">
            <div class="w-full h-full p-10 flex items-center justify-center relative">
                <!-- 主仪表盘容器 -->
                <div class="relative w-[1100px] h-[550px]">
                    <!-- 中央大表盘 -->
                    <div class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
                        <svg class="w-72 h-72" viewBox="0 0 200 200">
                            <!-- 外圈 -->
                            <circle cx="100" cy="100" r="95" fill="none" stroke="url(#goldGradient)" stroke-width="4"/>
                            <circle cx="100" cy="100" r="88" fill="none" stroke="#333" stroke-width="2"/>
                            
                            <!-- 刻度线 -->
                            <g transform="rotate(-135 100 100)">
                                <line x1="100" y1="20" x2="100" y2="35" stroke="#FFD700" stroke-width="3"/>
                                <line x1="100" y1="20" x2="100" y2="30" stroke="#FFD700" stroke-width="2" transform="rotate(30 100 100)"/>
                                <line x1="100" y1="20" x2="100" y2="30" stroke="#FFD700" stroke-width="2" transform="rotate(60 100 100)"/>
                                <line x1="100" y1="20" x2="100" y2="35" stroke="#FFD700" stroke-width="3" transform="rotate(90 100 100)"/>
                                <line x1="100" y1="20" x2="100" y2="30" stroke="#FFD700" stroke-width="2" transform="rotate(120 100 100)"/>
                                <line x1="100" y1="20" x2="100" y2="30" stroke="#FFD700" stroke-width="2" transform="rotate(150 100 100)"/>
                                <line x1="100" y1="20" x2="100" y2="35" stroke="#FFD700" stroke-width="3" transform="rotate(180 100 100)"/>
                                <line x1="100" y1="20" x2="100" y2="30" stroke="#FFD700" stroke-width="2" transform="rotate(210 100 100)"/>
                                <line x1="100" y1="20" x2="100" y2="30" stroke="#FFD700" stroke-width="2" transform="rotate(240 100 100)"/>
                                <line x1="100" y1="20" x2="100" y2="35" stroke="#FFD700" stroke-width="3" transform="rotate(270 100 100)"/>
                            </g>
                            
                            <!-- 指针 -->
                            <line x1="100" y1="100" x2="100" y2="40" stroke="#FFA500" stroke-width="4" stroke-linecap="round" transform="rotate(45 100 100)"/>
                            <circle cx="100" cy="100" r="8" fill="#FFD700"/>
                            <circle cx="100" cy="100" r="4" fill="#000"/>
                            
                            <!-- 中央数字显示 -->
                            <text x="100" y="140" font-size="32" font-weight="bold" text-anchor="middle" fill="#FFD700">85%</text>
                            <text x="100" y="160" font-size="12" text-anchor="middle" fill="#999">PERFORMANCE</text>
                            
                            <defs>
                                <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
                                    <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
                                    <stop offset="100%" style="stop-color:#FFD700;stop-opacity:1" />
                                </linearGradient>
                            </defs>
                        </svg>
                        
                        <div class="absolute -bottom-14 left-1/2 transform -translate-x-1/2 text-center">
                            <p class="text-[30px] font-bold text-yellow-400">卓越性能</p>
                        </div>
                    </div>
                    
                    <!-- 左侧小表盘 -->
                    <div class="absolute left-8 top-1/2 transform -translate-y-1/2">
                        <svg class="w-40 h-40" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="55" fill="none" stroke="#FFD700" stroke-width="2"/>
                            <circle cx="60" cy="60" r="48" fill="none" stroke="#333" stroke-width="1"/>
                            <line x1="60" y1="60" x2="60" y2="25" stroke="#FFA500" stroke-width="3" transform="rotate(120 60 60)"/>
                            <circle cx="60" cy="60" r="5" fill="#FFD700"/>
                            <text x="60" y="90" font-size="14" font-weight="bold" text-anchor="middle" fill="#FFD700">效率</text>
                            <text x="60" y="105" font-size="10" text-anchor="middle" fill="#999">EFFICIENCY</text>
                        </svg>
                    </div>
                    
                    <!-- 右侧小表盘 -->
                    <div class="absolute right-8 top-1/2 transform -translate-y-1/2">
                        <svg class="w-40 h-40" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="55" fill="none" stroke="#FFD700" stroke-width="2"/>
                            <circle cx="60" cy="60" r="48" fill="none" stroke="#333" stroke-width="1"/>
                            <line x1="60" y1="60" x2="60" y2="25" stroke="#FFA500" stroke-width="3" transform="rotate(150 60 60)"/>
                            <circle cx="60" cy="60" r="5" fill="#FFD700"/>
                            <text x="60" y="90" font-size="14" font-weight="bold" text-anchor="middle" fill="#FFD700">品质</text>
                            <text x="60" y="105" font-size="10" text-anchor="middle" fill="#999">QUALITY</text>
                        </svg>
                    </div>
                    
                    <!-- 顶部状态栏 -->
                    <div class="absolute top-0 left-1/2 transform -translate-x-1/2 flex gap-12">
                        <div class="text-center">
                            <div class="w-3 h-3 bg-green-500 rounded-full mb-2 mx-auto"></div>
                            <p class="text-[14px] text-gray-400">系统正常</p>
                        </div>
                        <div class="text-center">
                            <div class="w-3 h-3 bg-yellow-400 rounded-full mb-2 mx-auto"></div>
                            <p class="text-[14px] text-gray-400">待优化</p>
                        </div>
                        <div class="text-center">
                            <div class="w-3 h-3 bg-red-500 rounded-full mb-2 mx-auto"></div>
                            <p class="text-[14px] text-gray-400">需关注</p>
                        </div>
                    </div>
                    
                    <!-- 底部信息条 -->
                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-transparent via-yellow-900/30 to-transparent h-10 flex items-center justify-center">
                        <p class="text-yellow-400 text-[14px] tracking-widest">LUXURY PERFORMANCE DASHBOARD</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
