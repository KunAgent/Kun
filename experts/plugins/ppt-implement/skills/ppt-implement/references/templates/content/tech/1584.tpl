<!-- Template: 科技风格-变体4 (Content #1576) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
        
        <!-- 流动粒子背景 -->
        <div class="absolute inset-0 overflow-hidden">
            <div class="absolute top-1/4 left-0 w-3 h-3 bg-cyan-400 rounded-full opacity-60 animate-ping"></div>
            <div class="absolute top-1/3 left-1/4 w-2 h-2 bg-blue-400 rounded-full opacity-70" style="animation: float 3s ease-in-out infinite;"></div>
            <div class="absolute top-1/2 left-1/3 w-2.5 h-2.5 bg-purple-400 rounded-full opacity-50" style="animation: float 4s ease-in-out infinite;"></div>
            <div class="absolute bottom-1/3 right-1/4 w-2 h-2 bg-cyan-500 rounded-full opacity-60" style="animation: float 3.5s ease-in-out infinite;"></div>
        </div>
        
        <style>
            @keyframes float {
                0%, 100% { transform: translateY(0px) translateX(0px); }
                50% { transform: translateY(-20px) translateX(20px); }
            }
        </style>
        
        <div class="w-full h-full flex items-center justify-center relative">
            <!-- 内容区域 -->
            <div class="w-[1350px] h-[720px] mx-auto my-[20px] p-12 flex items-center justify-center relative">
                <!-- 标题 -->
                <h2 class="absolute top-12 left-1/2 transform -translate-x-1/2 text-[42px] font-bold text-cyan-400 z-10">
                    数据流转系统
                </h2>
                
                <!-- 流程图 -->
                <div class="relative w-full max-w-6xl">
                    <svg class="w-full h-96" viewBox="0 0 1000 400">
                    <!-- 连接线 -->
                    <defs>
                        <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:#00ffff;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#0080ff;stop-opacity:1" />
                        </linearGradient>
                        
                        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                            <polygon points="0 0, 10 3, 0 6" fill="#00ffff" />
                        </marker>
                    </defs>
                    
                    <!-- 主流程线 -->
                    <path d="M 150 200 L 215 200" stroke="url(#lineGrad)" stroke-width="3" marker-end="url(#arrowhead)"/>
                    <path d="M 325 200 L 390 200" stroke="url(#lineGrad)" stroke-width="3" marker-end="url(#arrowhead)"/>
                    <path d="M 500 200 L 565 200" stroke="url(#lineGrad)" stroke-width="3" marker-end="url(#arrowhead)"/>
                    <path d="M 675 200 L 740 200" stroke="url(#lineGrad)" stroke-width="3" marker-end="url(#arrowhead)"/>
                    
                    <!-- 数据流动效果 (动画点) -->
                    <circle r="4" fill="#00ffff">
                        <animateMotion dur="4s" repeatCount="indefinite" path="M 150 200 L 225 200 L 325 200 L 400 200 L 500 200 L 575 200 L 675 200 L 800 200"/>
                    </circle>
                    
                    <!-- 节点1 - 数据采集 -->
                    <g>
                        <rect x="50" y="150" width="100" height="100" rx="10" fill="#1e293b" stroke="#00ffff" stroke-width="2"/>
                        <text x="100" y="190" text-anchor="middle" fill="#00ffff" font-size="16" font-weight="bold">数据</text>
                        <text x="100" y="210" text-anchor="middle" fill="#00ffff" font-size="16" font-weight="bold">采集</text>
                        <text x="100" y="235" text-anchor="middle" fill="#64748b" font-size="12">Collect</text>
                    </g>
                    
                    <!-- 节点2 - 数据清洗 -->
                    <g>
                        <rect x="225" y="150" width="100" height="100" rx="10" fill="#1e293b" stroke="#0080ff" stroke-width="2"/>
                        <text x="275" y="190" text-anchor="middle" fill="#0080ff" font-size="16" font-weight="bold">数据</text>
                        <text x="275" y="210" text-anchor="middle" fill="#0080ff" font-size="16" font-weight="bold">清洗</text>
                        <text x="275" y="235" text-anchor="middle" fill="#64748b" font-size="12">Clean</text>
                    </g>
                    
                    <!-- 节点3 - 数据分析 -->
                    <g>
                        <rect x="400" y="150" width="100" height="100" rx="10" fill="#1e293b" stroke="#8b5cf6" stroke-width="2"/>
                        <text x="450" y="190" text-anchor="middle" fill="#8b5cf6" font-size="16" font-weight="bold">数据</text>
                        <text x="450" y="210" text-anchor="middle" fill="#8b5cf6" font-size="16" font-weight="bold">分析</text>
                        <text x="450" y="235" text-anchor="middle" fill="#64748b" font-size="12">Analyze</text>
                    </g>
                    
                    <!-- 节点4 - 数据存储 -->
                    <g>
                        <rect x="575" y="150" width="100" height="100" rx="10" fill="#1e293b" stroke="#10b981" stroke-width="2"/>
                        <text x="625" y="190" text-anchor="middle" fill="#10b981" font-size="16" font-weight="bold">数据</text>
                        <text x="625" y="210" text-anchor="middle" fill="#10b981" font-size="16" font-weight="bold">存储</text>
                        <text x="625" y="235" text-anchor="middle" fill="#64748b" font-size="12">Store</text>
                    </g>
                    
                    <!-- 节点5 - 数据应用 -->
                    <g>
                        <rect x="750" y="150" width="100" height="100" rx="10" fill="#1e293b" stroke="#f59e0b" stroke-width="2"/>
                        <text x="800" y="190" text-anchor="middle" fill="#f59e0b" font-size="16" font-weight="bold">数据</text>
                        <text x="800" y="210" text-anchor="middle" fill="#f59e0b" font-size="16" font-weight="bold">应用</text>
                        <text x="800" y="235" text-anchor="middle" fill="#64748b" font-size="12">Apply</text>
                    </g>
                    
                    <!-- 上方辅助信息 -->
                    <g>
                        <text x="100" y="120" text-anchor="middle" fill="#64748b" font-size="16">传感器</text>
                        <text x="275" y="120" text-anchor="middle" fill="#64748b" font-size="16">ETL引擎</text>
                        <text x="450" y="120" text-anchor="middle" fill="#64748b" font-size="16">AI算法</text>
                        <text x="625" y="120" text-anchor="middle" fill="#64748b" font-size="16">数据库</text>
                        <text x="800" y="120" text-anchor="middle" fill="#64748b" font-size="16">可视化</text>
                    </g>
                    
                    <!-- 下方统计数据 -->
                    <g>
                        <text x="100" y="290" text-anchor="middle" fill="#00ffff" font-size="24" font-weight="bold">1.2TB</text>
                        <text x="275" y="290" text-anchor="middle" fill="#0080ff" font-size="24" font-weight="bold">98%</text>
                        <text x="450" y="290" text-anchor="middle" fill="#8b5cf6" font-size="24" font-weight="bold">5ms</text>
                        <text x="625" y="290" text-anchor="middle" fill="#10b981" font-size="24" font-weight="bold">99.9%</text>
                        <text x="800" y="290" text-anchor="middle" fill="#f59e0b" font-size="24" font-weight="bold">Real-time</text>
                    </g>
                </svg>
            </div>
            
            <!-- 底部说明 -->
            <div class="absolute bottom-12 left-1/2 transform -translate-x-1/2 text-center">
                <p class="text-cyan-400 text-[20px] font-mono">DATA PIPELINE · HIGH PERFORMANCE · REAL-TIME PROCESSING</p>
            </div>
        </div>
    </div>
