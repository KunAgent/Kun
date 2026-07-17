import re
from loguru import logger


def clean_game_name(game_name: str) -> str:
    """
    Given game name, remove all unnecessary contents

    Args:
        game_name (str): name of the game

    Returns:
        game_name (str): name of the game without unnecessary contents
    """

    logger.info(f"【Tool util call】-【dashboard_clean_game_name】: Found game_name: {game_name}. ")

    game_name = game_name.lower()
    game_name = game_name.replace("dashboard", "")
    game_name = game_name.replace("经分", "")
    game_name = game_name.replace("game", "")
    game_name = game_name.replace("游戏", "")
    game_name = re.sub(r"\([^)]*\)", "", game_name)
    game_name = re.sub(r"（[^）]*\）", "", game_name)

    if "honor" in game_name.lower() and "king" in game_name.lower():
        game_name = "hok"
    elif "hok" in game_name.lower():
        game_name = "hok"
    elif "王者" in game_name and "世界" not in game_name:
        game_name = "王者（国内版）"

    if "beast" in game_name.lower():
        game_name = "Dying Light: The Beast"

    game_name = game_name.strip()

    logger.info(f"【Tool util return】-【dashboard_clean_game_name】: Parsed game_name: {game_name}. ")

    return game_name
