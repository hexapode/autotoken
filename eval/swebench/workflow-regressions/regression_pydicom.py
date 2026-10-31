from pydicom import config
from pydicom.dataset import Dataset
from pydicom.dataelem import RawDataElement
from pydicom.tag import Tag
config.settings.reading_validation_mode = config.RAISE
def dataset():
    ds = Dataset()
    ds.PatientName = 'Regression'
    tag = Tag(0x00200013)
    ds._dict[tag] = RawDataElement(tag, 'IS', 4, b'2.5 ', 0, True, True)
    return ds
try:
    dataset().to_json_dict(suppress_invalid_tags=False)
except (ValueError, TypeError):
    pass
else:
    raise AssertionError('Invalid raw IS value must raise without suppression')
result = dataset().to_json_dict(suppress_invalid_tags=True)
assert isinstance(result, dict)
assert '00100010' in result
print('Public-issue invalid-tag suppression regression passed')
