<!-- Template: 科技风-雷达扫描 (TOC #3576) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden" style="background: radial-gradient(circle at center, #0a1628 0%, #020814 100%);">
        <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex items-center justify-center relative">
            <!-- 雷达扫描线 -->
            <svg style="position: absolute; width: 600px; height: 600px; opacity: 0.2; left: 50%; top: 50%; transform: translate(-50%, -50%);">
                <circle cx="300" cy="300" r="100" fill="none" stroke="#00d4ff" stroke-width="1" opacity="0.6"/>
                <circle cx="300" cy="300" r="180" fill="none" stroke="#00d4ff" stroke-width="1" opacity="0.4"/>
                <circle cx="300" cy="300" r="260" fill="none" stroke="#00d4ff" stroke-width="1" opacity="0.2"/>
                <line x1="300" y1="300" x2="300" y2="40" stroke="#00d4ff" stroke-width="2" opacity="0.8">
                    <animateTransform attributeName="transform" type="rotate" from="0 300 300" to="360 300 300" dur="8s" repeatCount="indefinite"/>
                </line>
            </svg>

            <div class="max-w-6xl w-full relative z-10">
                <div class="text-center mb-12">
                    <h1 class="text-5xl font-bold mb-4 text-cyan-400" style="text-shadow: 0 0 20px rgba(0, 212, 255, 0.6); letter-spacing: 4px;">
                        SCAN TARGETS
                    </h1>
                    <div class="flex justify-center gap-2">
                        <div class="w-2 h-2 bg-cyan-400 rounded-full"></div>
                        <div class="w-8 h-2 bg-cyan-400/50"></div>
                        <div class="w-2 h-2 bg-cyan-400 rounded-full"></div>
                    </div>
                </div>
                
                <!-- 环形布局 -->
                <div class="grid grid-cols-4 gap-5">
                    
                    <div class="group cursor-pointer text-center">
                        <div style="position: relative; padding: 24px 16px; background: linear-gradient(135deg, rgba(0, 212, 255, 0.1) 0%, rgba(0, 100, 255, 0.05) 100%); border: 2px solid rgba(0, 212, 255, 0.5); clip-path: polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 0 100%); transition: all 0.3s;">
                            <div class="mb-3 flex justify-center">
                                <div style="width: 70px; height: 70px; background: radial-gradient(circle, rgba(0, 212, 255, 0.3), transparent); border: 2px solid #00d4ff; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                    <span class="text-3xl font-bold text-cyan-400">1</span>
                                </div>
                            </div>
                            <h3 class="text-lg font-bold text-cyan-400 mb-2">项目背景</h3>
                            <p class="text-cyan-300 text-sm opacity-80">了解项目的起源与目标</p>
                            <div style="position: absolute; top: 0; right: 0; width: 15px; height: 15px; background: #00d4ff; opacity: 0.3;"></div>
                        </div>
                    </div>
                    
                    <div class="group cursor-pointer text-center">
                        <div style="position: relative; padding: 24px 16px; background: linear-gradient(135deg, rgba(0, 212, 255, 0.1) 0%, rgba(0, 100, 255, 0.05) 100%); border: 2px solid rgba(0, 212, 255, 0.5); clip-path: polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 0 100%); transition: all 0.3s;">
                            <div class="mb-3 flex justify-center">
                                <div style="width: 70px; height: 70px; background: radial-gradient(circle, rgba(0, 212, 255, 0.3), transparent); border: 2px solid #00d4ff; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                    <span class="text-3xl font-bold text-cyan-400">2</span>
                                </div>
                            </div>
                            <h3 class="text-lg font-bold text-cyan-400 mb-2">核心功能</h3>
                            <p class="text-cyan-300 text-sm opacity-80">产品的主要功能介绍</p>
                            <div style="position: absolute; top: 0; right: 0; width: 15px; height: 15px; background: #00d4ff; opacity: 0.3;"></div>
                        </div>
                    </div>
                    
                    <div class="group cursor-pointer text-center">
                        <div style="position: relative; padding: 24px 16px; background: linear-gradient(135deg, rgba(0, 212, 255, 0.1) 0%, rgba(0, 100, 255, 0.05) 100%); border: 2px solid rgba(0, 212, 255, 0.5); clip-path: polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 0 100%); transition: all 0.3s;">
                            <div class="mb-3 flex justify-center">
                                <div style="width: 70px; height: 70px; background: radial-gradient(circle, rgba(0, 212, 255, 0.3), transparent); border: 2px solid #00d4ff; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                    <span class="text-3xl font-bold text-cyan-400">3</span>
                                </div>
                            </div>
                            <h3 class="text-lg font-bold text-cyan-400 mb-2">技术架构</h3>
                            <p class="text-cyan-300 text-sm opacity-80">系统设计与技术选型</p>
                            <div style="position: absolute; top: 0; right: 0; width: 15px; height: 15px; background: #00d4ff; opacity: 0.3;"></div>
                        </div>
                    </div>
                    
                    <div class="group cursor-pointer text-center">
                        <div style="position: relative; padding: 24px 16px; background: linear-gradient(135deg, rgba(0, 212, 255, 0.1) 0%, rgba(0, 100, 255, 0.05) 100%); border: 2px solid rgba(0, 212, 255, 0.5); clip-path: polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 0 100%); transition: all 0.3s;">
                            <div class="mb-3 flex justify-center">
                                <div style="width: 70px; height: 70px; background: radial-gradient(circle, rgba(0, 212, 255, 0.3), transparent); border: 2px solid #00d4ff; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                    <span class="text-3xl font-bold text-cyan-400">4</span>
                                </div>
                            </div>
                            <h3 class="text-lg font-bold text-cyan-400 mb-2">实施计划</h3>
                            <p class="text-cyan-300 text-sm opacity-80">项目的推进与时间安排</p>
                            <div style="position: absolute; top: 0; right: 0; width: 15px; height: 15px; background: #00d4ff; opacity: 0.3;"></div>
                        </div>
                    </div>
                    
                </div>
            </div>
        </div>
    </div>
