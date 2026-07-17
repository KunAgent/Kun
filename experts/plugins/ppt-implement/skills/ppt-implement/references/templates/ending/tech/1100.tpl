<div class="w-[1440px] h-[810px] bg-gradient-to-br from-black to-[#1a1a2e] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 数字雨背景 -->
    <div style="position: absolute; width: 100%; height: 100%; opacity: 0.15; font-family: 'Courier New', monospace; font-size: 15px; color: #00ff00; line-height: 1.2; overflow: hidden; white-space: pre;">
01001000 01100101 01101100 01101100 01101111
01010111 01101111 01110010 01101100 01100100
01010100 01100101 01100011 01101000 01101110
01001001 01101110 01101110 01101111 01110110
01000100 01101001 01100111 01101001 01110100
01000011 01101111 01100100 01100101 01110010
01010000 01110010 01101111 01100111 01110010
01000010 01101001 01101110 01100001 01110010
01000110 01110101 01110100 01110101 01110010
01010011 01111001 01110011 01110100 01100101
    </div>

    <!-- 矩阵方格装饰 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.2;">
      <defs>
        <pattern id="matrix-grid" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="50" height="50" fill="none" stroke="#00ff00" stroke-width="0.5"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#matrix-grid)"/>
    </svg>

    <!-- 扫描线效果 -->
    <div style="position: absolute; width: 100%; height: 3px; background: linear-gradient(90deg, transparent, #00ff00, transparent); top: 0; animation: scan-line 3s linear infinite;"></div>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div style="position: relative; padding: 45px 70px; background: rgba(0, 0, 0, 0.85); border: 3px solid #00ff00; box-shadow: 0 0 40px rgba(0, 255, 0, 0.5), inset 0 0 30px rgba(0, 255, 0, 0.1);">
        
        <!-- 角落数字装饰 -->
        <div style="position: absolute; top: -1px; left: -1px; padding: 4px 8px; background: #00ff00; color: #000; font-family: 'Courier New', monospace; font-size: 13px; font-weight: bold;">01</div>
        <div style="position: absolute; top: -1px; right: -1px; padding: 4px 8px; background: #00ff00; color: #000; font-family: 'Courier New', monospace; font-size: 13px; font-weight: bold;">10</div>
        <div style="position: absolute; bottom: -1px; left: -1px; padding: 4px 8px; background: #00ff00; color: #000; font-family: 'Courier New', monospace; font-size: 13px; font-weight: bold;">11</div>
        <div style="position: absolute; bottom: -1px; right: -1px; padding: 4px 8px; background: #00ff00; color: #000; font-family: 'Courier New', monospace; font-size: 13px; font-weight: bold;">00</div>

        <div class="text-[56px] font-bold text-[#00ff00] mb-10 text-center" style="letter-spacing: 5px; text-shadow: 0 0 20px rgba(0, 255, 0, 0.8), 0 0 40px rgba(0, 255, 0, 0.4);">
          感谢聆听
        </div>
        <div class="text-[26px] text-[#00ff00] text-center" style="letter-spacing: 3px; font-family: 'Courier New', monospace; opacity: 0.9;">
          期待与您再次相见
        </div>

        <!-- 闪烁光标 -->
        <div style="display: inline-block; width: 3px; height: 26px; background: #00ff00; margin-left: 5px; animation: blink-cursor 1s step-end infinite;"></div>
      </div>

      <!-- 浮动二进制代码 -->
      <div style="position: absolute; top: 13%; left: 7%; font-family: 'Courier New', monospace; font-size: 18px; color: #00ff00; opacity: 0.4; animation: float-code 4s ease-in-out infinite;">
        <div>01010100</div>
        <div>01001000</div>
        <div>01000001</div>
      </div>
      <div style="position: absolute; top: 55%; right: 8%; font-family: 'Courier New', monospace; font-size: 18px; color: #00ff00; opacity: 0.4; animation: float-code 4.5s ease-in-out infinite 0.5s;">
        <div>01001110</div>
        <div>01001011</div>
        <div>01010011</div>
      </div>
    </div>
  </div>

  <style>
    @keyframes scan-line {
      0% { top: 0; }
      100% { top: 100%; }
    }
    @keyframes blink-cursor {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }
    @keyframes float-code {
      0%, 100% { transform: translateY(0px); opacity: 0.4; }
      50% { transform: translateY(-18px); opacity: 0.6; }
    }
  </style>
</div>
