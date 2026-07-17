"""Simplified exceptions for react agent skills."""


class NoResultException(Exception):
    def __init__(self, message: str = "", search_query: str = "", use_web_search: bool = False, **kwargs):
        self.message = message
        self.search_query = search_query
        self.use_web_search = use_web_search
        # Store any extra kwargs as attributes for forward compatibility
        for k, v in kwargs.items():
            setattr(self, k, v)
        super().__init__(message)


class DataSourceException(Exception):
    def __init__(self, message: str = "", **kwargs):
        self.message = message
        for k, v in kwargs.items():
            setattr(self, k, v)
        super().__init__(message)


class ValidationException(Exception):
    def __init__(self, message: str = "", **kwargs):
        self.message = message
        for k, v in kwargs.items():
            setattr(self, k, v)
        super().__init__(message)
