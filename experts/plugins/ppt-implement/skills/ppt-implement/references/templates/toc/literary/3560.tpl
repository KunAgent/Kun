<!-- 
模板ID: 3560
模板名称: 文艺风-复古书页
适用场景: 复古文艺目录页
设计特点: 书本造型,优雅配色,手写字体风格
-->
<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #2c3e50 0%, #1a252f 100%);">
  <!-- 优雅纹理背景 -->
  <div class="absolute inset-0 opacity-10" style="background-image: radial-gradient(circle at 20% 80%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.1) 0%, transparent 50%);"></div>
  
  <!-- 书本主体 -->
  <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style="width: 1000px; height: 620px;">
    <!-- 书本阴影 -->
    <div class="absolute inset-0" style="background: rgba(0,0,0,0.3); transform: translate(10px, 10px); border-radius: 5px 15px 15px 5px; filter: blur(15px);"></div>
    
    <!-- 书脊 -->
    <div class="absolute left-0 top-0 bottom-0" style="width: 36px; background: linear-gradient(90deg, #4a6741 0%, #5d8a54 50%, #4a6741 100%); border-radius: 5px 0 0 5px; box-shadow: inset -3px 0 8px rgba(0,0,0,0.2);">
      <div class="absolute top-8 left-1/2 -translate-x-1/2 w-5 h-16" style="background: linear-gradient(180deg, #c9a86c 0%, #a68b4d 100%); border-radius: 2px;"></div>
      <div class="absolute bottom-8 left-1/2 -translate-x-1/2 w-5 h-16" style="background: linear-gradient(180deg, #c9a86c 0%, #a68b4d 100%); border-radius: 2px;"></div>
    </div>
    
    <!-- 左页 -->
    <div class="absolute top-0 bottom-0" style="left: 36px; width: 482px; background: linear-gradient(135deg, #faf8f5 0%, #f0ebe3 100%); box-shadow: inset -15px 0 25px rgba(0,0,0,0.05);">
      <!-- 装饰边框 -->
      <div class="absolute top-6 left-6 right-6 bottom-6 border border-gray-200 rounded-sm"></div>
      <div class="absolute top-10 left-10 right-10 bottom-10 border border-gray-100 rounded-sm"></div>
      
      <!-- 标题 -->
      <div class="pt-14 px-12 text-center">
        <h2 class="text-4xl tracking-widest" style="font-family: 'STKaiti', 'KaiTi', serif; color: #3d5a3a;">目 录</h2>
        <div class="mt-3 mx-auto flex items-center justify-center gap-3">
          <div style="width: 40px; height: 1px; background: linear-gradient(90deg, transparent, #5d8a54);"></div>
          <div class="w-2 h-2 rounded-full" style="background: #5d8a54;"></div>
          <div style="width: 40px; height: 1px; background: linear-gradient(90deg, #5d8a54, transparent);"></div>
        </div>
      </div>
      
      <!-- 章节列表 -->
      <div class="px-12 mt-8 space-y-5">
        <div class="flex items-center gap-4 p-3 rounded-lg transition-all" style="background: rgba(93, 138, 84, 0.08);">
          <div class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center" style="background: linear-gradient(135deg, #5d8a54 0%, #3d5a3a 100%); box-shadow: 0 2px 8px rgba(93, 138, 84, 0.3);">
            <span class="text-lg font-medium" style="font-family: 'STKaiti', serif; color: #faf8f5;">壹</span>
          </div>
          <div class="flex-1">
            <div class="text-lg font-medium" style="font-family: 'STKaiti', serif; color: #3d5a3a;">项目背景</div>
            <div class="text-sm mt-0.5" style="color: #7a8b76;">了解项目的起源与目标</div>
          </div>
        </div>
        
        <div class="flex items-center gap-4 p-3 rounded-lg transition-all" style="background: rgba(93, 138, 84, 0.08);">
          <div class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center" style="background: linear-gradient(135deg, #5d8a54 0%, #3d5a3a 100%); box-shadow: 0 2px 8px rgba(93, 138, 84, 0.3);">
            <span class="text-lg font-medium" style="font-family: 'STKaiti', serif; color: #faf8f5;">贰</span>
          </div>
          <div class="flex-1">
            <div class="text-lg font-medium" style="font-family: 'STKaiti', serif; color: #3d5a3a;">核心功能</div>
            <div class="text-sm mt-0.5" style="color: #7a8b76;">产品的主要功能介绍</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 右页 -->
    <div class="absolute top-0 bottom-0 right-0" style="width: 482px; background: linear-gradient(135deg, #faf8f5 0%, #f0ebe3 100%); border-radius: 0 5px 5px 0; box-shadow: inset 15px 0 25px rgba(0,0,0,0.03);">
      <!-- 装饰边框 -->
      <div class="absolute top-6 left-6 right-6 bottom-6 border border-gray-200 rounded-sm"></div>
      <div class="absolute top-10 left-10 right-10 bottom-10 border border-gray-100 rounded-sm"></div>
      
      <!-- 章节列表 -->
      <div class="px-12 pt-14 space-y-5">
        <div class="flex items-center gap-4 p-3 rounded-lg transition-all" style="background: rgba(93, 138, 84, 0.08);">
          <div class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center" style="background: linear-gradient(135deg, #5d8a54 0%, #3d5a3a 100%); box-shadow: 0 2px 8px rgba(93, 138, 84, 0.3);">
            <span class="text-lg font-medium" style="font-family: 'STKaiti', serif; color: #faf8f5;">叁</span>
          </div>
          <div class="flex-1">
            <div class="text-lg font-medium" style="font-family: 'STKaiti', serif; color: #3d5a3a;">技术架构</div>
            <div class="text-sm mt-0.5" style="color: #7a8b76;">系统设计与技术选型</div>
          </div>
        </div>
        
        <div class="flex items-center gap-4 p-3 rounded-lg transition-all" style="background: rgba(93, 138, 84, 0.08);">
          <div class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center" style="background: linear-gradient(135deg, #5d8a54 0%, #3d5a3a 100%); box-shadow: 0 2px 8px rgba(93, 138, 84, 0.3);">
            <span class="text-lg font-medium" style="font-family: 'STKaiti', serif; color: #faf8f5;">肆</span>
          </div>
          <div class="flex-1">
            <div class="text-lg font-medium" style="font-family: 'STKaiti', serif; color: #3d5a3a;">实施计划</div>
            <div class="text-sm mt-0.5" style="color: #7a8b76;">项目推进与时间安排</div>
          </div>
        </div>
      </div>
      
      <!-- 装饰植物图案 -->
      <div class="absolute bottom-16 right-12 opacity-15">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <path d="M50 90 Q50 60 30 40 Q50 50 50 30 Q50 50 70 40 Q50 60 50 90" fill="none" stroke="#3d5a3a" stroke-width="1.5"/>
          <ellipse cx="30" cy="35" rx="12" ry="8" fill="none" stroke="#3d5a3a" stroke-width="1" transform="rotate(-30 30 35)"/>
          <ellipse cx="70" cy="35" rx="12" ry="8" fill="none" stroke="#3d5a3a" stroke-width="1" transform="rotate(30 70 35)"/>
          <ellipse cx="50" cy="25" rx="10" ry="7" fill="none" stroke="#3d5a3a" stroke-width="1"/>
        </svg>
      </div>
      
      <!-- 页码 -->
      <div class="absolute bottom-8 right-12 text-sm" style="font-family: 'STKaiti', serif; color: #7a8b76;">- 1 -</div>
    </div>
  </div>
  
  <!-- 角落装饰 -->
  <div class="absolute top-6 left-6 opacity-20">
    <svg width="50" height="50" viewBox="0 0 50 50">
      <path d="M0 0 L50 0 L50 8 L8 8 L8 50 L0 50 Z" fill="#c9a86c"/>
    </svg>
  </div>
  <div class="absolute bottom-6 right-6 opacity-20 rotate-180">
    <svg width="50" height="50" viewBox="0 0 50 50">
      <path d="M0 0 L50 0 L50 8 L8 8 L8 50 L0 50 Z" fill="#c9a86c"/>
    </svg>
  </div>
</div>
