<!-- Template: 几何风格-变体8 (Content #1548) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-slate-50 to-gray-100">
        
        <!-- 内容区域 -->
        <div class="w-[1350px] h-[720px] mx-auto my-[20px]">
        
        <!-- 三角形分割网格布局 -->
        <div class="w-full h-full flex flex-col p-12">
            <div class="text-center mb-9">
                <h2 class="text-[40px] font-bold text-gray-900 mb-5">三角分割</h2>
                <p class="text-[22px] text-gray-600">多边形网格系统的空间划分艺术</p>
            </div>
            
            <!-- 三角形网格系统 -->
            <div class="flex-1 relative">
                <!-- 使用SVG创建三角形网格背景 -->
                <svg class="absolute inset-0 w-full h-full" viewBox="0 0 1350 607" preserveAspectRatio="xMidYMid meet">
                    <!-- 背景三角形网格线 -->
                    <defs>
                        <pattern id="triangleGrid" x="0" y="0" width="112" height="98" patternUnits="userSpaceOnUse">
                            <path d="M 0 0 L 56 98 L 112 0 Z M 56 98 L 112 0 L 168 98 Z" 
                                  stroke="#e5e7eb" stroke-width="1" fill="none"/>
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#triangleGrid)" opacity="0.3"/>
                    
                    <!-- 主要三角形块 - 第一行 -->
                    <g transform="translate(112, 45)">
                        <polygon points="168,0 0,292 337,292" fill="url(#grad1)" opacity="0.95"/>
                        <text x="168" y="202" text-anchor="middle" fill="white" font-size="36" font-weight="bold">策略规划</text>
                        <text x="168" y="242" text-anchor="middle" fill="white" font-size="18">Strategic Planning</text>
                    </g>
                    
                    <g transform="translate(506, 45)">
                        <polygon points="168,0 0,292 337,292" fill="url(#grad2)" opacity="0.95"/>
                        <text x="168" y="202" text-anchor="middle" fill="white" font-size="36" font-weight="bold">执行实施</text>
                        <text x="168" y="242" text-anchor="middle" fill="white" font-size="18">Implementation</text>
                    </g>
                    
                    <g transform="translate(900, 45)">
                        <polygon points="168,0 0,292 337,292" fill="url(#grad3)" opacity="0.95"/>
                        <text x="168" y="202" text-anchor="middle" fill="white" font-size="36" font-weight="bold">效果评估</text>
                        <text x="168" y="242" text-anchor="middle" fill="white" font-size="18">Evaluation</text>
                    </g>
                    
                    <!-- 倒三角形 - 第二行 -->
                    <g transform="translate(309, 292)">
                        <polygon points="0,0 168,270 337,0" fill="url(#grad4)" opacity="0.9"/>
                        <text x="168" y="168" text-anchor="middle" fill="white" font-size="31" font-weight="bold">协同合作</text>
                        <text x="168" y="202" text-anchor="middle" fill="white" font-size="16">Collaboration</text>
                    </g>
                    
                    <g transform="translate(703, 292)">
                        <polygon points="0,0 168,270 337,0" fill="url(#grad5)" opacity="0.9"/>
                        <text x="168" y="168" text-anchor="middle" fill="white" font-size="31" font-weight="bold">持续优化</text>
                        <text x="168" y="202" text-anchor="middle" fill="white" font-size="16">Optimization</text>
                    </g>
                    
                    <!-- 渐变定义 -->
                    <defs>
                        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#1d4ed8;stop-opacity:1" />
                        </linearGradient>
                        <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#8b5cf6;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#6d28d9;stop-opacity:1" />
                        </linearGradient>
                        <linearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#ec4899;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#be185d;stop-opacity:1" />
                        </linearGradient>
                        <linearGradient id="grad4" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#10b981;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#047857;stop-opacity:1" />
                        </linearGradient>
                        <linearGradient id="grad5" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#f59e0b;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#d97706;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    
                    <!-- 连接线 -->
                    <line x1="281" y1="225" x2="478" y2="394" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5,5" opacity="0.5"/>
                    <line x1="675" y1="225" x2="872" y2="394" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5,5" opacity="0.5"/>
                    <line x1="1069" y1="225" x2="872" y2="394" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5,5" opacity="0.5"/>
                    
                    <!-- 连接点 -->
                    <circle cx="281" cy="225" r="9" fill="#6366f1"/>
                    <circle cx="675" cy="225" r="9" fill="#a855f7"/>
                    <circle cx="1069" cy="225" r="9" fill="#ec4899"/>
                    <circle cx="478" cy="394" r="9" fill="#10b981"/>
                    <circle cx="872" cy="394" r="9" fill="#f59e0b"/>
                </svg>
            </div>
        </div>
        
        </div>
    </div>
